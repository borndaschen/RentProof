import { X509Certificate, createPrivateKey, createPublicKey, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import process from "node:process";
import { dirname, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSecureLanProfile } from "../src/server/network/secure-lan-profile.ts";
import { parsePostgresDatabaseConfig } from "../src/adapters/database/postgres/config.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environmentFile = resolve(repositoryRoot, ".env.secure-lan.local");
if (!existsSync(environmentFile)) throw new Error("RENTPROOF_ENV_FILE_MISSING");
process.loadEnvFile(environmentFile);
process.env.RENTPROOF_REPOSITORY_ROOT = repositoryRoot;

const profile = parseSecureLanProfile(process.env);
const database = parsePostgresDatabaseConfig(process.env);
if (database.role !== "app" || database.environment !== "secure_demo") {
  throw new Error("SECURE_LAN_DATABASE_INVALID");
}
const tls = await loadAndVerifyTlsMaterial(profile);
await verifyRealDataRoot(profile.realDataRoot);
verifyFirewall(profile.bindAddress, profile.externalPort);

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(
  process.execPath,
  [nextBin, "start", "-H", "127.0.0.1", "-p", String(profile.internalPort)],
  { cwd: repositoryRoot, stdio: "inherit", env: process.env },
);

await waitForNext(child, profile.internalPort, profile.exactHost, profile.externalPort);

const server = createHttpsServer(
  {
    key: tls.privateKey,
    cert: tls.certificate,
    ca: tls.caCertificate,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    honorCipherOrder: true,
    requestCert: false,
    rejectUnauthorized: false,
    maxHeaderSize: 32 * 1024,
  },
  (request, response) => {
    if (!request.url || !safeIncomingHeaders(request.headers, profile.exactHost)) {
      response.writeHead(400, responseHeaders());
      response.end('{"error":"REQUEST_NETWORK_BOUNDARY_REJECTED"}');
      return;
    }
    const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
    if (!remoteAddress) {
      response.writeHead(400, responseHeaders());
      response.end('{"error":"REQUEST_NETWORK_BOUNDARY_REJECTED"}');
      return;
    }
    const headers = { ...request.headers };
    for (const name of [
      "connection",
      "proxy-connection",
      "forwarded",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-port",
      "x-forwarded-proto",
      "x-forwarded-server",
      "x-original-host",
      "x-host",
      "upgrade",
    ]) {
      delete headers[name];
    }
    headers.host = profile.exactHost;
    headers["x-forwarded-for"] = remoteAddress;
    headers["x-forwarded-host"] = profile.exactHost;
    headers["x-forwarded-port"] = String(profile.externalPort);
    headers["x-forwarded-proto"] = "https";
    headers["x-rentproof-network-verified"] = process.env.RENTPROOF_INTERNAL_PROXY_TOKEN;

    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: profile.internalPort,
        method: request.method,
        path: request.url,
        headers,
        timeout: 120_000,
      },
      (upstreamResponse) => {
        const responseHeaderMap = { ...upstreamResponse.headers };
        delete responseHeaderMap.connection;
        delete responseHeaderMap["keep-alive"];
        delete responseHeaderMap["proxy-authenticate"];
        delete responseHeaderMap["proxy-authorization"];
        delete responseHeaderMap.te;
        delete responseHeaderMap.trailer;
        delete responseHeaderMap["transfer-encoding"];
        delete responseHeaderMap.upgrade;
        responseHeaderMap["strict-transport-security"] = "max-age=86400";
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaderMap);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("timeout", () => upstream.destroy(new Error("UPSTREAM_TIMEOUT")));
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, responseHeaders());
      response.end('{"error":"UPSTREAM_UNAVAILABLE"}');
    });
    request.pipe(upstream);
  },
);

server.headersTimeout = 10_000;
server.requestTimeout = 120_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;
server.on("upgrade", (_request, socket) => socket.destroy());
server.on("clientError", (_error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

await new Promise<void>((resolvePromise, rejectPromise) => {
  server.once("error", rejectPromise);
  server.listen(profile.externalPort, profile.bindAddress, () => {
    server.off("error", rejectPromise);
    resolvePromise();
  });
});

process.stdout.write(`RentProof HTTPS ready at ${profile.exactOrigin}\n`);

let stopping = false;
async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  child.kill(signal);
}
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
child.once("exit", (code, signal) => {
  if (!stopping) server.close();
  process.exitCode = signal ? 1 : (code ?? 1);
});

function responseHeaders(): Record<string, string> {
  return {
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
}

function safeIncomingHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  expectedHost: string,
): boolean {
  if (headers.host !== expectedHost || headers.upgrade !== undefined) return false;
  return ![
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-forwarded-server",
    "x-original-host",
    "x-host",
    "proxy-connection",
    "x-rentproof-network-verified",
  ].some((name) => headers[name] !== undefined);
}

function normalizeRemoteAddress(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.startsWith("::ffff:") ? value.slice(7) : value;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(normalized) ? normalized : null;
}

async function loadAndVerifyTlsMaterial(input: {
  bindAddress: string;
  certificatePath: string;
  privateKeyPath: string;
  caCertificatePath: string;
}) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("SECURE_LAN_CERT_ROOT_MISSING");
  const allowedRoot = await realpath(resolve(localAppData, "RentProof", "certificates"));
  const paths = await Promise.all(
    [input.certificatePath, input.privateKeyPath, input.caCertificatePath].map(async (path) => {
      const resolved = await realpath(path);
      const rel = relative(allowedRoot, resolved);
      const stat = await lstat(resolved);
      if (
        !rel ||
        rel.startsWith("..") ||
        win32.isAbsolute(rel) ||
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size > 64 * 1024
      ) {
        throw new Error("SECURE_LAN_CERT_PATH_INVALID");
      }
      return resolved;
    }),
  );
  const [certificatePath, privateKeyPath, caCertificatePath] = paths;
  if (!certificatePath || !privateKeyPath || !caCertificatePath) {
    throw new Error("SECURE_LAN_CERT_PATH_INVALID");
  }
  const [certificate, privateKey, caCertificate] = await Promise.all([
    readFile(certificatePath),
    readFile(privateKeyPath),
    readFile(caCertificatePath),
  ]);
  const leaf = new X509Certificate(certificate);
  const ca = new X509Certificate(caCertificate);
  const key = createPrivateKey(privateKey);
  const leafPublic = leaf.publicKey.export({ format: "der", type: "spki" });
  const keyPublic = createPublicKey(key).export({ format: "der", type: "spki" });
  const remaining = Date.parse(leaf.validTo) - Date.now();
  if (
    leaf.checkIP(input.bindAddress) !== input.bindAddress ||
    remaining < 24 * 60 * 60 * 1000 ||
    Date.parse(leaf.validFrom) > Date.now() ||
    !leaf.checkIssued(ca) ||
    !leaf.verify(ca.publicKey) ||
    !ca.verify(ca.publicKey) ||
    leafPublic.byteLength !== keyPublic.byteLength ||
    !timingSafeEqual(leafPublic, keyPublic)
  ) {
    throw new Error("SECURE_LAN_CERTIFICATE_INVALID");
  }
  return { certificate, privateKey, caCertificate };
}

async function verifyRealDataRoot(path: string): Promise<void> {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("REAL_DATA_STORAGE_ROOT_INVALID");
  const expected = await realpath(resolve(localAppData, "RentProof", "real-data"));
  const resolved = await realpath(path);
  const stat = await lstat(resolved);
  if (
    win32.normalize(resolved).toLowerCase() !== win32.normalize(expected).toLowerCase() ||
    !stat.isDirectory() ||
    stat.isSymbolicLink()
  ) {
    throw new Error("REAL_DATA_STORAGE_ROOT_INVALID");
  }
}

function verifyFirewall(bindAddress: string, port: number): void {
  const stateScript = resolve(
    repositoryRoot,
    "scripts",
    "windows",
    "Get-RentProofLanFirewallState.ps1",
  );
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      stateScript,
      "-NodeExe",
      process.execPath,
      "-BindAddress",
      bindAddress,
      "-Port",
      String(port),
      "-ConfirmNoPortForwarding",
      "-ConfirmNoUpnpExposure",
      "-ConfirmNoTunnel",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 },
  );
  if (result.status !== 0) throw new Error("SECURE_LAN_FIREWALL_PREFLIGHT_FAILED");
  const state = JSON.parse(result.stdout) as unknown;
  if (!validFirewallState(state)) throw new Error("SECURE_LAN_FIREWALL_PREFLIGHT_INVALID");
}

function validFirewallState(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const rule = state["firewallRule"];
  return (
    state["networkCategory"] === "Private" &&
    state["portForwardingDetected"] === false &&
    state["upnpExposureDetected"] === false &&
    state["tunnelDetected"] === false &&
    typeof rule === "object" &&
    rule !== null &&
    !Array.isArray(rule) &&
    (rule as Record<string, unknown>)["enabled"] === true
  );
}

async function waitForNext(
  childProcess: ChildProcess,
  port: number,
  exactHost: string,
  externalPort: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (childProcess.exitCode !== null) throw new Error("NEXT_SERVER_EXITED");
    const ready = await new Promise<boolean>((resolvePromise) => {
      const request = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/runtime-status",
          headers: {
            host: exactHost,
            "x-forwarded-for": "127.0.0.1",
            "x-forwarded-host": exactHost,
            "x-forwarded-port": String(externalPort),
            "x-forwarded-proto": "https",
          },
          timeout: 500,
        },
        (response) => {
          response.resume();
          resolvePromise((response.statusCode ?? 500) < 500);
        },
      );
      request.on("timeout", () => request.destroy());
      request.on("error", () => resolvePromise(false));
      request.end();
    });
    if (ready) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  childProcess.kill("SIGTERM");
  throw new Error("NEXT_SERVER_START_TIMEOUT");
}
