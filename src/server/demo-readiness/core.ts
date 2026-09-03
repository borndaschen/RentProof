import { createHash, timingSafeEqual } from "node:crypto";
import { createConnection, createServer } from "node:net";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

export type DemoReadinessLevel = "PASS" | "WARN" | "BLOCKED";
export type DemoReadinessProfile = "local";

export type DemoReadinessItem = Readonly<{
  level: DemoReadinessLevel;
  code: string;
  message: string;
}>;

export type DemoReadinessReport = Readonly<{
  schemaVersion: "rentproof.demo-readiness.v1";
  profile: DemoReadinessProfile;
  items: readonly DemoReadinessItem[];
  blocked: boolean;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

export type DemoReadinessDependencies = Readonly<{
  verifyToolchain: () => Promise<{ nodeVersion: string; pnpmVersion: string }>;
  verifyGolden: (input: {
    demoRoot: string;
    repositoryRoot: string;
    runtimeRoot: string;
    version: string;
  }) => Promise<{ manifestHash: string; fileCount: number }>;
  verifyRuntimeRoot: (input: {
    runtimeRoot: string;
    repositoryRoot: string;
    demoRoot: string;
  }) => Promise<"ready" | "safe_uninitialized">;
  isPortAvailable: (host: string, port: number) => Promise<boolean>;
  isTcpListenerReachable: (host: string, port: number) => Promise<boolean>;
}>;

const VERSION_PATTERN = /^golden-v[1-9][0-9]*$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const browserOpenAiCredentialVariable = ["NEXT", "PUBLIC", "OPENAI", "API", "KEY"].join("_");
const EXPECTED_GOLDEN_HASH = "f3797356a1e3ea4bbed7a87802fdaaa001985557fb7b51845a9f6a4454157d7b";

export async function checkDemoReadiness(input: {
  profile: DemoReadinessProfile;
  environment: Environment;
  repositoryRoot: string;
  userProfile?: string | undefined;
  localAppData?: string | undefined;
  dependencies: DemoReadinessDependencies;
}): Promise<DemoReadinessReport> {
  const items: DemoReadinessItem[] = [];
  const add = (level: DemoReadinessLevel, code: string, message: string): void => {
    items.push(Object.freeze({ level, code, message }));
  };

  try {
    const verified = await input.dependencies.verifyToolchain();
    add("PASS", "TOOLCHAIN_LOCKED", `Node ${verified.nodeVersion}; pnpm ${verified.pnpmVersion}.`);
  } catch (error: unknown) {
    add("BLOCKED", reasonCode(error, "TOOLCHAIN_CHECK_FAILED"), "Locked toolchain check failed.");
  }

  const environment = input.environment;
  const expectedDeployment = "local_development";
  const host = environment["RENTPROOF_BIND_HOST"] ?? "";
  const port = parsePort(environment["RENTPROOF_PORT"]);
  const version = environment["RENTPROOF_DEMO_CASE_VERSION"] ?? "";
  const userProfile = input.userProfile ?? "";
  const localAppData = input.localAppData ?? "";
  const demoRoot =
    environment["RENTPROOF_DEMO_DIR"]?.trim() ||
    (userProfile ? win32.join(userProfile, "RentProof-Demo") : "");
  const runtimeRoot =
    environment["RENTPROOF_RUNTIME_DIR"]?.trim() ||
    (localAppData ? win32.join(localAppData, "RentProof", "runtime") : "");

  if (validateSyntheticRuntime(environment, expectedDeployment, host, port)) {
    add(
      "PASS",
      "SYNTHETIC_RUNTIME_CONFIG_VALID",
      "HTTP Demo is synthetic-only with exact listener policy.",
    );
  } else {
    add(
      "BLOCKED",
      "SYNTHETIC_RUNTIME_CONFIG_INVALID",
      "Synthetic Demo listener/profile configuration is invalid.",
    );
  }

  const ruleProfile = environment["RENTPROOF_RULE_PROFILE"] ?? "p0";
  if (ruleProfile === "p0" || ruleProfile === "p1") {
    add(
      "PASS",
      ruleProfile === "p1" ? "OFFICIAL_RULE_PROFILE_P1" : "OFFICIAL_RULE_PROFILE_P0",
      ruleProfile === "p1"
        ? "Explicit P1 profile enables all 10 official-rule checks for this server run."
        : "P0 profile keeps the sealed Golden flow on its six official-rule checks.",
    );
  } else {
    add(
      "BLOCKED",
      "OFFICIAL_RULE_PROFILE_INVALID",
      "Official-rule profile must be the server-only value p0 or p1.",
    );
  }

  if (environment[browserOpenAiCredentialVariable] !== undefined) {
    add(
      "BLOCKED",
      "BROWSER_SECRET_CONFIGURATION_FORBIDDEN",
      "A browser-visible OpenAI key variable is configured.",
    );
  } else {
    add(
      "PASS",
      "BROWSER_SECRET_CONFIGURATION_ABSENT",
      "No browser-visible OpenAI key variable is configured.",
    );
  }

  if (!VERSION_PATTERN.test(version) || demoRoot === "") {
    add(
      "BLOCKED",
      "DEMO_SELECTION_INVALID",
      "A safe explicit Golden version and external Demo root are required.",
    );
  } else {
    try {
      const result = await input.dependencies.verifyGolden({
        demoRoot,
        repositoryRoot: input.repositoryRoot,
        runtimeRoot,
        version,
      });
      add(
        "PASS",
        "DEMO_SEAL_VERIFIED",
        `${version}; ${result.fileCount} files; SHA-256 ${result.manifestHash}.`,
      );
    } catch (error: unknown) {
      add(
        "BLOCKED",
        reasonCode(error, "DEMO_VERIFICATION_FAILED"),
        "External sealed Golden Demo verification failed.",
      );
    }
  }

  if (runtimeRoot === "" || demoRoot === "") {
    add(
      "BLOCKED",
      "RUNTIME_ROOT_CONFIGURATION_MISSING",
      "A safe external runtime root cannot be resolved.",
    );
  } else {
    try {
      const state = await input.dependencies.verifyRuntimeRoot({
        runtimeRoot,
        repositoryRoot: input.repositoryRoot,
        demoRoot,
      });
      add(
        state === "ready" ? "PASS" : "WARN",
        state === "ready" ? "RUNTIME_ROOT_READY" : "RUNTIME_ROOT_SAFE_UNINITIALIZED",
        state === "ready"
          ? "External runtime root is available and passes the path boundary checks."
          : "Runtime root is safe but has not been initialized; the validated launcher may initialize it.",
      );
    } catch (error: unknown) {
      add(
        "BLOCKED",
        reasonCode(error, "RUNTIME_ROOT_INVALID"),
        "Runtime root safety validation failed.",
      );
    }
  }

  if (host !== "" && port !== undefined) {
    try {
      const available = await input.dependencies.isPortAvailable(host, port);
      add(
        available ? "PASS" : "BLOCKED",
        available ? "LISTENER_PORT_AVAILABLE" : "LISTENER_PORT_IN_USE",
        available
          ? `Listener ${host}:${String(port)} is available.`
          : "Configured application listener is already in use.",
      );
    } catch {
      add(
        "BLOCKED",
        "LISTENER_PORT_CHECK_FAILED",
        "Configured application listener could not be checked.",
      );
    }
  } else {
    add("BLOCKED", "LISTENER_CONFIGURATION_INVALID", "Configured application listener is invalid.");
  }

  add("PASS", "LAN_FIREWALL_NOT_REQUIRED", "Local HTTP listens on loopback only.");

  addSelfHostedAuthState(items, input.profile, environment);
  await addPostgresState(items, environment, input.dependencies);
  addOpenAiState(items, environment);

  return Object.freeze({
    schemaVersion: "rentproof.demo-readiness.v1",
    profile: input.profile,
    items: Object.freeze(items),
    blocked: items.some((item) => item.level === "BLOCKED"),
  });
}

function validateSyntheticRuntime(
  environment: Environment,
  expectedDeployment: string,
  host: string,
  port: number | undefined,
): boolean {
  if (
    environment["RENTPROOF_DEPLOYMENT_PROFILE"] !== expectedDeployment ||
    environment["RENTPROOF_ALLOW_REAL_DATA"] !== "false" ||
    port === undefined ||
    environment["RENTPROOF_PUBLIC_ORIGIN"] === undefined
  )
    return false;
  if (host !== "127.0.0.1") return false;
  let origin: URL;
  try {
    origin = new URL(environment["RENTPROOF_PUBLIC_ORIGIN"]);
  } catch {
    return false;
  }
  if (origin.protocol !== "http:" || origin.hostname !== host || Number(origin.port) !== port)
    return false;
  const exactHost = `${host}:${String(port)}`;
  const allowedHosts = csv(environment["RENTPROOF_ALLOWED_HOSTS"]);
  const allowedOrigins = csv(environment["RENTPROOF_ALLOWED_ORIGINS"]);
  return (
    allowedHosts.length > 0 &&
    allowedOrigins.length > 0 &&
    allowedHosts.every((value) => value !== "*" && value !== "null") &&
    allowedOrigins.every((value) => value !== "*" && value !== "null") &&
    allowedHosts.includes(exactHost) &&
    allowedOrigins.includes(origin.origin)
  );
}

function addSelfHostedAuthState(
  items: DemoReadinessItem[],
  _profile: DemoReadinessProfile,
  env: Environment,
): void {
  const mode = env["RENTPROOF_AUTH_MODE"] ?? "synthetic";
  const tokenKey = env["RENTPROOF_AUTH_TOKEN_KEY"];
  const hasTokenKey = Boolean(tokenKey);
  const hasLegacyManagedAuth = [
    ["CLERK", "PUBLISHABLE", "KEY"].join("_"),
    ["CLERK", "SECRET", "KEY"].join("_"),
    ["RENTPROOF", "CLERK", "FRONTEND", "ORIGIN"].join("_"),
  ].some((key) => Boolean(env[key]));
  if (mode === "synthetic") {
    items.push(
      !hasTokenKey && !hasLegacyManagedAuth
        ? item(
            "PASS",
            "AUTH_SYNTHETIC_MODE",
            "Account auth is disabled for the synthetic local Demo.",
          )
        : item(
            "BLOCKED",
            "AUTH_SECRET_WITH_AUTH_DISABLED",
            "Account configuration is present while account auth is disabled.",
          ),
    );
    return;
  }
  if (
    mode !== "self_hosted" ||
    !tokenKey ||
    !/^[A-Za-z0-9_-]{43,}$/u.test(tokenKey) ||
    env["RENTPROOF_DATABASE_ADAPTER"] !== "postgres" ||
    env["RENTPROOF_DATABASE_ROLE"] !== "app" ||
    env["RENTPROOF_DATABASE_ENVIRONMENT"] !== "synthetic_demo"
  ) {
    items.push(
      item(
        "BLOCKED",
        "LOCAL_SELF_HOSTED_AUTH_CONFIGURATION_INVALID",
        "Local self-hosted auth requires a server HMAC key and the synthetic PostgreSQL app role.",
      ),
    );
    return;
  }
  items.push(
    item(
      "PASS",
      "LOCAL_SELF_HOSTED_AUTH_CONFIGURATION_PRESENT",
      "Required local auth configuration is present; secret values were not displayed.",
    ),
  );
}

async function addPostgresState(
  items: DemoReadinessItem[],
  env: Environment,
  dependencies: DemoReadinessDependencies,
): Promise<void> {
  const adapter = env["RENTPROOF_DATABASE_ADAPTER"] ?? "disabled";
  if (adapter === "disabled") {
    items.push(
      item(
        env["RENTPROOF_DATABASE_URL"] ? "WARN" : "PASS",
        env["RENTPROOF_DATABASE_URL"]
          ? "POSTGRES_DISABLED_WITH_CONFIGURATION"
          : "POSTGRES_DISABLED",
        env["RENTPROOF_DATABASE_URL"]
          ? "PostgreSQL is disabled but a connection configuration is present; its value was not displayed."
          : "PostgreSQL is not requested for this Demo profile.",
      ),
    );
    return;
  }
  const parsed = parseSyntheticPostgres(env);
  if (parsed === undefined) {
    items.push(
      item(
        "BLOCKED",
        "POSTGRES_CONFIGURATION_INVALID",
        "Synthetic Demo PostgreSQL configuration is invalid.",
      ),
    );
    return;
  }
  let reachable = false;
  try {
    reachable = await dependencies.isTcpListenerReachable(parsed.host, parsed.port);
  } catch {
    reachable = false;
  }
  items.push(
    item(
      reachable ? "PASS" : "BLOCKED",
      reachable ? "POSTGRES_LOOPBACK_LISTENER_READY" : "POSTGRES_LOOPBACK_LISTENER_UNAVAILABLE",
      reachable
        ? "A loopback PostgreSQL listener is reachable; no database credentials were transmitted."
        : "The configured loopback PostgreSQL listener is unavailable.",
    ),
  );
}

function parseSyntheticPostgres(env: Environment): { host: string; port: number } | undefined {
  if (
    env["RENTPROOF_DATABASE_ADAPTER"] !== "postgres" ||
    env["RENTPROOF_DATABASE_ROLE"] !== "app" ||
    env["RENTPROOF_DATABASE_ENVIRONMENT"] !== "synthetic_demo" ||
    env["RENTPROOF_ALLOW_REAL_DATA"] !== "false"
  )
    return undefined;
  const max = Number(env["RENTPROOF_DATABASE_MAX_CONNECTIONS"]);
  if (!Number.isInteger(max) || max < 1 || max > 20) return undefined;
  let url: URL;
  try {
    url = new URL(env["RENTPROOF_DATABASE_URL"] ?? "");
  } catch {
    return undefined;
  }
  if (
    !new Set(["postgres:", "postgresql:"]).has(url.protocol) ||
    !url.username ||
    !url.password ||
    !new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) ||
    !/^\/rentproof_demo(?:_[a-z0-9]+)*$/u.test(url.pathname) ||
    url.search !== "" ||
    url.hash !== ""
  )
    return undefined;
  const port = url.port === "" ? 5432 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host: url.hostname === "[::1]" ? "::1" : url.hostname, port };
}

function addOpenAiState(items: DemoReadinessItem[], env: Environment): void {
  if (env["RENTPROOF_LLM_MODE"] === "fixture") {
    items.push(item("PASS", "OPENAI_FIXTURE_MODE", "Fixture mode will not call OpenAI."));
    return;
  }
  if (env["RENTPROOF_LLM_MODE"] !== "live" || !env["OPENAI_API_KEY"]) {
    items.push(
      item("BLOCKED", "OPENAI_LIVE_CONFIGURATION_MISSING", "OpenAI Live mode is incomplete."),
    );
    return;
  }
  items.push(
    env["OPENAI_PROJECT_LIMITS_CONFIRMED"] === "true"
      ? item(
          "PASS",
          "OPENAI_PROJECT_LIMITS_CONFIRMED",
          "OpenAI Live mode is configured and Project limits are operator-confirmed.",
        )
      : item(
          "WARN",
          "OPENAI_PROJECT_LIMITS_UNVERIFIED",
          "OpenAI Live mode may incur cost; Project spend/rate limits are not operator-confirmed.",
        ),
  );
}

export async function verifySealedGolden(input: {
  demoRoot: string;
  repositoryRoot: string;
  runtimeRoot: string;
  version: string;
}): Promise<{ manifestHash: string; fileCount: number }> {
  if (process.platform !== "win32" || !VERSION_PATTERN.test(input.version))
    throw new Error("DEMO_DIR_UNSAFE");
  assertWindowsNoOverlap(input.demoRoot, [input.repositoryRoot, input.runtimeRoot]);
  const caseRoot = win32.join(input.demoRoot, "cases", input.version);
  const [rootReal, caseReal] = await Promise.all([realpath(input.demoRoot), realpath(caseRoot)]);
  if (!sameWindowsPath(rootReal, input.demoRoot) || !sameWindowsPath(caseReal, caseRoot))
    throw new Error("DEMO_DIR_UNSAFE");
  await assertNoLinks(rootReal);
  const manifestBytes = await readFile(win32.join(caseReal, "manifest.json"));
  const sealBytes = await readFile(win32.join(caseReal, "manifest.sha256"));
  if (manifestBytes.byteLength > 1_048_576) throw new Error("DEMO_MANIFEST_TOO_LARGE");
  const seal = new TextDecoder("ascii", { fatal: true }).decode(sealBytes);
  if (!/^[0-9a-f]{64}\n?$/u.test(seal)) throw new Error("DEMO_MANIFEST_SEAL_INVALID");
  const actualHash = createHash("sha256").update(manifestBytes).digest("hex");
  const expectedHash = seal.endsWith("\n") ? seal.slice(0, -1) : seal;
  if (!timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex")))
    throw new Error("DEMO_MANIFEST_SEAL_MISMATCH");
  if (input.version === "golden-v1" && actualHash !== EXPECTED_GOLDEN_HASH)
    throw new Error("DEMO_MANIFEST_SEAL_MISMATCH");
  const manifest = parseManifest(manifestBytes, input.version);
  const actualFiles = await listFiles(caseReal);
  const controls = new Set(["manifest.json", "manifest.sha256"]);
  const dataFiles = actualFiles.filter((path) => !controls.has(path.toLowerCase()));
  const expectedPaths = new Set(manifest.files.map((file) => file.path.toLowerCase()));
  if (
    dataFiles.length !== expectedPaths.size ||
    dataFiles.some((path) => !expectedPaths.has(path.toLowerCase()))
  )
    throw new Error("DEMO_MANIFEST_INVENTORY_MISMATCH");
  for (const file of manifest.files) {
    const absolutePath = resolve(caseReal, ...file.path.split("/"));
    const stat = await lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes)
      throw new Error("DEMO_MANIFEST_FILE_INVALID");
    const resolved = await realpath(absolutePath);
    if (!isContained(caseReal, resolved) || (await hashFile(resolved)) !== file.sha256)
      throw new Error("DEMO_MANIFEST_FILE_HASH_MISMATCH");
  }
  return { manifestHash: actualHash, fileCount: manifest.files.length };
}

function parseManifest(
  bytes: Uint8Array,
  version: string,
): { files: Array<{ path: string; bytes: number; sha256: string }> } {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) throw new Error("BOM");
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("DEMO_MANIFEST_INVALID");
  }
  if (
    !isRecord(value) ||
    value["schema"] !== "rentproof.demo-manifest.v1" ||
    value["caseVersion"] !== version ||
    value["synthetic"] !== true ||
    !Array.isArray(value["files"]) ||
    value["files"].length > 100
  )
    throw new Error("DEMO_MANIFEST_INVALID");
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  const paths = new Set<string>();
  for (const candidate of value["files"]) {
    if (
      !isRecord(candidate) ||
      typeof candidate["path"] !== "string" ||
      typeof candidate["bytes"] !== "number" ||
      typeof candidate["sha256"] !== "string"
    )
      throw new Error("DEMO_MANIFEST_INVALID");
    const path = candidate["path"];
    if (
      !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(path) ||
      path.includes("..") ||
      isAbsolute(path) ||
      !Number.isSafeInteger(candidate["bytes"]) ||
      candidate["bytes"] < 0 ||
      !SHA256_PATTERN.test(candidate["sha256"])
    )
      throw new Error("DEMO_MANIFEST_INVALID");
    const key = path.toLowerCase();
    if (paths.has(key)) throw new Error("DEMO_MANIFEST_INVALID");
    paths.add(key);
    files.push({ path, bytes: candidate["bytes"], sha256: candidate["sha256"] });
  }
  return { files };
}

export async function verifyRuntimeRootReadonly(input: {
  runtimeRoot: string;
  repositoryRoot: string;
  demoRoot: string;
}): Promise<"ready" | "safe_uninitialized"> {
  if (process.platform !== "win32") throw new Error("RUNTIME_PLATFORM_UNSUPPORTED");
  assertWindowsNoOverlap(input.runtimeRoot, [input.repositoryRoot, input.demoRoot]);
  try {
    const resolved = await realpath(input.runtimeRoot);
    if (!sameWindowsPath(resolved, input.runtimeRoot))
      throw new Error("RUNTIME_REPARSE_POINT_DISALLOWED");
    await assertNoLinks(resolved);
    return "ready";
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      const parent = await nearestExistingParent(input.runtimeRoot);
      await assertNoLinks(parent);
      return "safe_uninitialized";
    }
    throw error;
  }
}

function assertWindowsNoOverlap(candidate: string, forbidden: string[]): void {
  if (
    !/^[A-Za-z]:\\/u.test(candidate) ||
    candidate.startsWith("\\\\") ||
    candidate !== win32.normalize(candidate)
  )
    throw new Error("WINDOWS_PATH_INVALID");
  if (forbidden.some((path) => path && pathsOverlap(candidate, path)))
    throw new Error("PATH_BOUNDARY_OVERLAP");
}

async function nearestExistingParent(path: string): Promise<string> {
  let cursor = path;
  for (;;) {
    try {
      return await realpath(cursor);
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
      const parent = win32.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
}

async function assertNoLinks(path: string): Promise<void> {
  const root = win32.parse(path).root;
  let cursor = root;
  for (const segment of path.slice(root.length).split(/[\\/]/u).filter(Boolean)) {
    cursor = win32.join(cursor, segment);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error("REPARSE_POINT_DISALLOWED");
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("DEMO_MANIFEST_FILE_UNSAFE");
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(resolve(directory, entry.name), relativePath)));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error("DEMO_MANIFEST_FILE_UNSAFE");
  }
  return files;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function pathsOverlap(left: string, right: string): boolean {
  const a = win32
    .normalize(left)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();
  const b = win32
    .normalize(right)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();
  return a === b || a.startsWith(`${b}\\`) || b.startsWith(`${a}\\`);
}

function sameWindowsPath(left: string, right: string): boolean {
  return (
    win32
      .normalize(left)
      .replace(/[\\/]+$/u, "")
      .toLowerCase() ===
    win32
      .normalize(right)
      .replace(/[\\/]+$/u, "")
      .toLowerCase()
  );
}

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path !== "" && !path.startsWith("..") && !isAbsolute(path) && !path.split(sep).includes("..")
  );
}

function parsePort(value: string | undefined): number | undefined {
  if (!/^(?:[1-9]\d{3,4})$/u.test(value ?? "")) return undefined;
  const port = Number(value);
  return port >= 1024 && port <= 65535 ? port : undefined;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function item(level: DemoReadinessLevel, code: string, message: string): DemoReadinessItem {
  return Object.freeze({ level, code, message });
}

function reasonCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
    ? error.message
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function defaultPortAvailabilityProbe(host: string, port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolveProbe(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolveProbe(true)));
  });
}

export function defaultTcpListenerProbe(host: string, port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host, port });
    const done = (value: boolean): void => {
      socket.destroy();
      resolveProbe(value);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
