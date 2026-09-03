import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const environmentFile = process.argv[3] === "--lan" ? ".env.lan.local" : ".env.local";
if (existsSync(environmentFile)) {
  process.loadEnvFile(environmentFile);
} else {
  throw new Error("RENTPROOF_ENV_FILE_MISSING");
}
process.env.RENTPROOF_REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  throw new Error("NEXT_RUN_MODE_INVALID");
}
if (process.argv[3] !== undefined && process.argv[3] !== "--lan") {
  throw new Error("NEXT_RUN_PROFILE_INVALID");
}

const rfc1918 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u;
const schema = z
  .object({
    RENTPROOF_DEPLOYMENT_PROFILE: z.enum(["local_development", "lan_development"]),
    RENTPROOF_BIND_HOST: z.string().min(1),
    RENTPROOF_PORT: z.coerce.number().int().min(1024).max(65535),
    RENTPROOF_PUBLIC_ORIGIN: z.url(),
    RENTPROOF_ALLOWED_HOSTS: z.string().min(1),
    RENTPROOF_ALLOWED_ORIGINS: z.string().min(1),
    RENTPROOF_ALLOW_REAL_DATA: z.literal("false"),
    RENTPROOF_AUTH_MODE: z.enum(["synthetic", "self_hosted"]).default("synthetic"),
    RENTPROOF_RULE_PROFILE: z.enum(["p0", "p1"]).default("p0"),
    RENTPROOF_AUTH_TOKEN_KEY: z.string().optional(),
    RENTPROOF_DATABASE_ADAPTER: z.enum(["disabled", "postgres"]).default("disabled"),
    RENTPROOF_DATABASE_URL: z.string().optional(),
    RENTPROOF_DATABASE_ROLE: z.enum(["app", "migration"]).default("app"),
    RENTPROOF_DATABASE_ENVIRONMENT: z
      .enum(["synthetic_demo", "local_test"])
      .default("synthetic_demo"),
    RENTPROOF_LLM_MODE: z.enum(["fixture", "live"]),
    OPENAI_PROJECT_LIMITS_CONFIRMED: z.enum(["true", "false"]),
    RENTPROOF_DEMO_CASE_VERSION: z.string().regex(/^golden-v[1-9][0-9]*$/u),
    OPENAI_CONVERSATION_MODEL: z.literal("gpt-5.6-luna"),
    OPENAI_CONVERSATION_REASONING_EFFORT: z.literal("low"),
    OPENAI_EVIDENCE_MODEL: z.literal("gpt-5.6-terra"),
    OPENAI_EVIDENCE_REASONING_EFFORT: z.literal("medium"),
    OPENAI_SERVICE_TIER: z.literal("default"),
    NEXT_PUBLIC_OPENAI_API_KEY: z.never().optional(),
  })
  .strict();

const parsed = schema.safeParse({
  RENTPROOF_DEPLOYMENT_PROFILE: process.env.RENTPROOF_DEPLOYMENT_PROFILE,
  RENTPROOF_BIND_HOST: process.env.RENTPROOF_BIND_HOST,
  RENTPROOF_PORT: process.env.RENTPROOF_PORT,
  RENTPROOF_PUBLIC_ORIGIN: process.env.RENTPROOF_PUBLIC_ORIGIN,
  RENTPROOF_ALLOWED_HOSTS: process.env.RENTPROOF_ALLOWED_HOSTS,
  RENTPROOF_ALLOWED_ORIGINS: process.env.RENTPROOF_ALLOWED_ORIGINS,
  RENTPROOF_ALLOW_REAL_DATA: process.env.RENTPROOF_ALLOW_REAL_DATA,
  RENTPROOF_AUTH_MODE: process.env.RENTPROOF_AUTH_MODE,
  RENTPROOF_RULE_PROFILE: process.env.RENTPROOF_RULE_PROFILE,
  RENTPROOF_AUTH_TOKEN_KEY: process.env.RENTPROOF_AUTH_TOKEN_KEY || undefined,
  RENTPROOF_DATABASE_ADAPTER: process.env.RENTPROOF_DATABASE_ADAPTER,
  RENTPROOF_DATABASE_URL: process.env.RENTPROOF_DATABASE_URL || undefined,
  RENTPROOF_DATABASE_ROLE: process.env.RENTPROOF_DATABASE_ROLE,
  RENTPROOF_DATABASE_ENVIRONMENT: process.env.RENTPROOF_DATABASE_ENVIRONMENT,
  RENTPROOF_LLM_MODE: process.env.RENTPROOF_LLM_MODE,
  OPENAI_PROJECT_LIMITS_CONFIRMED: process.env.OPENAI_PROJECT_LIMITS_CONFIRMED,
  RENTPROOF_DEMO_CASE_VERSION: process.env.RENTPROOF_DEMO_CASE_VERSION,
  OPENAI_CONVERSATION_MODEL: process.env.OPENAI_CONVERSATION_MODEL,
  OPENAI_CONVERSATION_REASONING_EFFORT: process.env.OPENAI_CONVERSATION_REASONING_EFFORT,
  OPENAI_EVIDENCE_MODEL: process.env.OPENAI_EVIDENCE_MODEL,
  OPENAI_EVIDENCE_REASONING_EFFORT: process.env.OPENAI_EVIDENCE_REASONING_EFFORT,
  OPENAI_SERVICE_TIER: process.env.OPENAI_SERVICE_TIER,
  NEXT_PUBLIC_OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
});
if (!parsed.success) {
  console.error("RENTPROOF_CONFIGURATION_INVALID");
  process.exit(1);
}

const env = parsed.data;
const origin = new URL(env.RENTPROOF_PUBLIC_ORIGIN);
if (origin.hostname !== env.RENTPROOF_BIND_HOST || Number(origin.port) !== env.RENTPROOF_PORT) {
  console.error("RENTPROOF_ORIGIN_BIND_MISMATCH");
  process.exit(1);
}

const allowedHosts = env.RENTPROOF_ALLOWED_HOSTS.split(",").map((value) => value.trim());
const allowedOrigins = env.RENTPROOF_ALLOWED_ORIGINS.split(",").map((value) => value.trim());
if (allowedHosts.some((value) => value === "*" || value === "null")) {
  console.error("RENTPROOF_ALLOWED_HOST_INVALID");
  process.exit(1);
}
if (allowedOrigins.some((value) => value === "*" || value === "null")) {
  console.error("RENTPROOF_ALLOWED_ORIGIN_INVALID");
  process.exit(1);
}

if (env.RENTPROOF_DEPLOYMENT_PROFILE === "local_development") {
  if (env.RENTPROOF_BIND_HOST !== "127.0.0.1") {
    console.error("LOCAL_BIND_MUST_BE_LOOPBACK");
    process.exit(1);
  }
} else if (!rfc1918.test(env.RENTPROOF_BIND_HOST)) {
  console.error("LAN_BIND_MUST_BE_RFC1918_IPV4");
  process.exit(1);
}

const legacyManagedAuthKeys = [
  ["CLERK", "PUBLISHABLE", "KEY"].join("_"),
  ["CLERK", "SECRET", "KEY"].join("_"),
  ["RENTPROOF", "CLERK", "FRONTEND", "ORIGIN"].join("_"),
  ["RENTPROOF", "CLERK", "HOBBY", "CONFIRMED"].join("_"),
  ["RENTPROOF", "CLERK", "EMAIL", "PASSWORD", "CONFIRMED"].join("_"),
  ["RENTPROOF", "CLERK", "EMAIL", "DELIVERY", "CONFIRMED"].join("_"),
  ["RENTPROOF", "CLERK", "SMS", "DISABLED", "CONFIRMED"].join("_"),
  ["RENTPROOF", "CLERK", "ORIGIN", "CONFIRMED"].join("_"),
];
const hasLegacyManagedAuthConfiguration = legacyManagedAuthKeys.some(
  (key) => Boolean(process.env[key]) && process.env[key] !== "false",
);
if (hasLegacyManagedAuthConfiguration) {
  console.error("LEGACY_MANAGED_AUTH_CONFIGURATION_FORBIDDEN");
  process.exit(1);
}
if (env.RENTPROOF_DEPLOYMENT_PROFILE === "lan_development") {
  if (env.RENTPROOF_AUTH_MODE !== "synthetic" || env.RENTPROOF_AUTH_TOKEN_KEY) {
    console.error("LAN_AUTH_FORBIDDEN");
    process.exit(1);
  }
} else if (env.RENTPROOF_AUTH_MODE === "self_hosted") {
  if (
    !env.RENTPROOF_AUTH_TOKEN_KEY ||
    !/^[A-Za-z0-9_-]{43,}$/u.test(env.RENTPROOF_AUTH_TOKEN_KEY) ||
    env.RENTPROOF_DATABASE_ADAPTER !== "postgres" ||
    !env.RENTPROOF_DATABASE_URL ||
    env.RENTPROOF_DATABASE_ROLE !== "app" ||
    env.RENTPROOF_DATABASE_ENVIRONMENT !== "synthetic_demo"
  ) {
    console.error("LOCAL_SELF_HOSTED_AUTH_CONFIGURATION_INVALID");
    process.exit(1);
  }
} else if (env.RENTPROOF_AUTH_TOKEN_KEY) {
  console.error("AUTH_SECRET_WITH_AUTH_DISABLED");
  process.exit(1);
}

if (env.RENTPROOF_DEPLOYMENT_PROFILE === "lan_development") {
  const operatorConfirmation = "confirmed-for-this-run";
  if (
    process.env.RENTPROOF_LAN_NO_PORT_FORWARDING !== operatorConfirmation ||
    process.env.RENTPROOF_LAN_NO_UPNP_EXPOSURE !== operatorConfirmation ||
    process.env.RENTPROOF_LAN_NO_TUNNEL !== operatorConfirmation
  ) {
    console.error("LAN_EXPOSURE_CONFIRMATION_REQUIRED");
    process.exit(1);
  }
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const stateScript = resolve(scriptDirectory, "windows", "Get-RentProofLanFirewallState.ps1");
  const firewall = spawnSync(
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
      env.RENTPROOF_BIND_HOST,
      "-Port",
      String(env.RENTPROOF_PORT),
      "-ConfirmNoPortForwarding",
      "-ConfirmNoUpnpExposure",
      "-ConfirmNoTunnel",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (firewall.status !== 0) {
    console.error("LAN_FIREWALL_PREFLIGHT_FAILED");
    process.exit(1);
  }
  try {
    const state = JSON.parse(firewall.stdout);
    if (
      state.networkCategory !== "Private" ||
      state.firewallRule?.enabled !== true ||
      state.portForwardingDetected !== false ||
      state.upnpExposureDetected !== false ||
      state.tunnelDetected !== false
    ) {
      throw new Error("LAN_FIREWALL_NOT_READY");
    }
  } catch {
    console.error("LAN_FIREWALL_PREFLIGHT_INVALID");
    process.exit(1);
  }
}

if (env.RENTPROOF_LLM_MODE === "live" && !process.env.OPENAI_API_KEY) {
  console.error("MODEL_CONFIGURATION_MISSING");
  process.exit(1);
}

if (env.RENTPROOF_LLM_MODE === "live" && env.OPENAI_PROJECT_LIMITS_CONFIRMED === "false") {
  console.warn(
    "OPENAI_PROJECT_LIMITS_UNVERIFIED: Live mode is enabled, but Project spend and rate limits are not operator-confirmed.",
  );
}

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(
  process.execPath,
  [nextBin, mode, "-H", env.RENTPROOF_BIND_HOST, "-p", String(env.RENTPROOF_PORT)],
  { stdio: "inherit", env: process.env },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
