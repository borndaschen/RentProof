import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const environmentFile = ".env.local";
if (!existsSync(environmentFile)) throw new Error("RENTPROOF_ENV_FILE_MISSING");
process.loadEnvFile(environmentFile);
process.env.RENTPROOF_REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") throw new Error("NEXT_RUN_MODE_INVALID");
if (process.argv[3] !== undefined) throw new Error("NEXT_RUN_PROFILE_INVALID");

const schema = z
  .object({
    RENTPROOF_DEPLOYMENT_PROFILE: z.literal("local_development"),
    RENTPROOF_BIND_HOST: z.literal("127.0.0.1"),
    RENTPROOF_PORT: z.coerce.number().int().min(1024).max(65_535),
    RENTPROOF_PUBLIC_ORIGIN: z.url(),
    RENTPROOF_ALLOWED_HOSTS: z.string().min(1),
    RENTPROOF_ALLOWED_ORIGINS: z.string().min(1),
    RENTPROOF_ALLOW_REAL_DATA: z.literal("false"),
    RENTPROOF_AUTH_MODE: z.enum(["synthetic", "self_hosted"]).default("synthetic"),
    RENTPROOF_AUTH_TOKEN_KEY: z.string().optional(),
    RENTPROOF_DATABASE_ADAPTER: z.enum(["disabled", "postgres"]).default("disabled"),
    RENTPROOF_DATABASE_URL: z.string().optional(),
    RENTPROOF_DATABASE_ROLE: z.enum(["app", "migration"]).default("app"),
    RENTPROOF_DATABASE_ENVIRONMENT: z
      .enum(["synthetic_demo", "local_test"])
      .default("synthetic_demo"),
    RENTPROOF_LLM_MODE: z.enum(["fixture", "live"]),
    OPENAI_PROJECT_LIMITS_CONFIRMED: z.enum(["true", "false"]),
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
  RENTPROOF_AUTH_TOKEN_KEY: process.env.RENTPROOF_AUTH_TOKEN_KEY || undefined,
  RENTPROOF_DATABASE_ADAPTER: process.env.RENTPROOF_DATABASE_ADAPTER,
  RENTPROOF_DATABASE_URL: process.env.RENTPROOF_DATABASE_URL || undefined,
  RENTPROOF_DATABASE_ROLE: process.env.RENTPROOF_DATABASE_ROLE,
  RENTPROOF_DATABASE_ENVIRONMENT: process.env.RENTPROOF_DATABASE_ENVIRONMENT,
  RENTPROOF_LLM_MODE: process.env.RENTPROOF_LLM_MODE,
  OPENAI_PROJECT_LIMITS_CONFIRMED: process.env.OPENAI_PROJECT_LIMITS_CONFIRMED,
  NEXT_PUBLIC_OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
});
if (!parsed.success) fail("RENTPROOF_CONFIGURATION_INVALID");
const env = parsed.data;
const exactHost = `127.0.0.1:${String(env.RENTPROOF_PORT)}`;
const exactOrigin = `http://${exactHost}`;
const allowedHosts = env.RENTPROOF_ALLOWED_HOSTS.split(",").map((value) => value.trim());
const allowedOrigins = env.RENTPROOF_ALLOWED_ORIGINS.split(",").map((value) => value.trim());
if (
  env.RENTPROOF_PUBLIC_ORIGIN !== exactOrigin ||
  allowedHosts.some(
    (value) => ![exactHost, `localhost:${String(env.RENTPROOF_PORT)}`].includes(value),
  ) ||
  allowedOrigins.some(
    (value) => ![exactOrigin, `http://localhost:${String(env.RENTPROOF_PORT)}`].includes(value),
  )
) {
  fail("LOCAL_NETWORK_CONFIGURATION_INVALID");
}
if (env.RENTPROOF_AUTH_MODE === "self_hosted") {
  if (
    !env.RENTPROOF_AUTH_TOKEN_KEY ||
    !/^[A-Za-z0-9_-]{43,}$/u.test(env.RENTPROOF_AUTH_TOKEN_KEY) ||
    env.RENTPROOF_DATABASE_ADAPTER !== "postgres" ||
    !env.RENTPROOF_DATABASE_URL ||
    env.RENTPROOF_DATABASE_ROLE !== "app" ||
    env.RENTPROOF_DATABASE_ENVIRONMENT !== "synthetic_demo"
  ) {
    fail("LOCAL_SELF_HOSTED_AUTH_CONFIGURATION_INVALID");
  }
} else if (env.RENTPROOF_AUTH_TOKEN_KEY) {
  fail("AUTH_SECRET_WITH_AUTH_DISABLED");
}
if (env.RENTPROOF_LLM_MODE === "live" && !process.env.OPENAI_API_KEY) {
  fail("MODEL_CONFIGURATION_MISSING");
}

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(
  process.execPath,
  [nextBin, mode, "-H", "127.0.0.1", "-p", String(env.RENTPROOF_PORT)],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}
