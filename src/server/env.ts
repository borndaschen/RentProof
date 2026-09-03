import "server-only";
import { z } from "zod";

const baseEnvironmentSchema = z
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
    RENTPROOF_LLM_MODE: z.enum(["fixture", "live"]),
    OPENAI_PROJECT_LIMITS_CONFIRMED: z.enum(["true", "false"]),
    RENTPROOF_DEMO_CASE_VERSION: z.string().regex(/^golden-v[1-9][0-9]*$/u),
    OPENAI_CONVERSATION_MODEL: z.literal("gpt-5.6-luna"),
    OPENAI_CONVERSATION_REASONING_EFFORT: z.literal("low"),
    OPENAI_EVIDENCE_MODEL: z.literal("gpt-5.6-terra"),
    OPENAI_EVIDENCE_REASONING_EFFORT: z.literal("medium"),
    OPENAI_SERVICE_TIER: z.literal("default"),
  })
  .strict();

export type ServerEnvironment = z.infer<typeof baseEnvironmentSchema> & {
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
};

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  if (cachedEnvironment) return cachedEnvironment;

  if (process.env["NEXT_PUBLIC_OPENAI_API_KEY"]) {
    throw new Error("PUBLIC_OPENAI_KEY_FORBIDDEN");
  }

  const parsed = baseEnvironmentSchema.parse({
    RENTPROOF_DEPLOYMENT_PROFILE: process.env["RENTPROOF_DEPLOYMENT_PROFILE"],
    RENTPROOF_BIND_HOST: process.env["RENTPROOF_BIND_HOST"],
    RENTPROOF_PORT: process.env["RENTPROOF_PORT"],
    RENTPROOF_PUBLIC_ORIGIN: process.env["RENTPROOF_PUBLIC_ORIGIN"],
    RENTPROOF_ALLOWED_HOSTS: process.env["RENTPROOF_ALLOWED_HOSTS"],
    RENTPROOF_ALLOWED_ORIGINS: process.env["RENTPROOF_ALLOWED_ORIGINS"],
    RENTPROOF_ALLOW_REAL_DATA: process.env["RENTPROOF_ALLOW_REAL_DATA"],
    RENTPROOF_AUTH_MODE: process.env["RENTPROOF_AUTH_MODE"],
    RENTPROOF_RULE_PROFILE: process.env["RENTPROOF_RULE_PROFILE"],
    RENTPROOF_LLM_MODE: process.env["RENTPROOF_LLM_MODE"],
    OPENAI_PROJECT_LIMITS_CONFIRMED: process.env["OPENAI_PROJECT_LIMITS_CONFIRMED"],
    RENTPROOF_DEMO_CASE_VERSION: process.env["RENTPROOF_DEMO_CASE_VERSION"],
    OPENAI_CONVERSATION_MODEL: process.env["OPENAI_CONVERSATION_MODEL"],
    OPENAI_CONVERSATION_REASONING_EFFORT: process.env["OPENAI_CONVERSATION_REASONING_EFFORT"],
    OPENAI_EVIDENCE_MODEL: process.env["OPENAI_EVIDENCE_MODEL"],
    OPENAI_EVIDENCE_REASONING_EFFORT: process.env["OPENAI_EVIDENCE_REASONING_EFFORT"],
    OPENAI_SERVICE_TIER: process.env["OPENAI_SERVICE_TIER"],
  });

  if (parsed.RENTPROOF_LLM_MODE === "live" && !process.env["OPENAI_API_KEY"]) {
    throw new Error("MODEL_CONFIGURATION_MISSING");
  }

  validateAuthProfile(parsed);

  cachedEnvironment = {
    ...parsed,
    allowedHosts: parseCsv(parsed.RENTPROOF_ALLOWED_HOSTS),
    allowedOrigins: parseCsv(parsed.RENTPROOF_ALLOWED_ORIGINS),
  };
  return cachedEnvironment;
}

function validateAuthProfile(environment: z.infer<typeof baseEnvironmentSchema>): void {
  if (hasLegacyManagedAuthConfiguration(process.env)) {
    throw new Error("LEGACY_MANAGED_AUTH_CONFIGURATION_FORBIDDEN");
  }
  const tokenKey = process.env["RENTPROOF_AUTH_TOKEN_KEY"];

  if (environment.RENTPROOF_DEPLOYMENT_PROFILE === "lan_development") {
    if (environment.RENTPROOF_AUTH_MODE !== "synthetic" || tokenKey)
      throw new Error("LAN_AUTH_FORBIDDEN");
    return;
  }

  if (environment.RENTPROOF_AUTH_MODE === "self_hosted") {
    const origin = new URL(environment.RENTPROOF_PUBLIC_ORIGIN);
    if (
      environment.RENTPROOF_BIND_HOST !== "127.0.0.1" ||
      origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" ||
      process.env["RENTPROOF_DATABASE_ADAPTER"] !== "postgres" ||
      process.env["RENTPROOF_DATABASE_ROLE"] !== "app" ||
      process.env["RENTPROOF_DATABASE_ENVIRONMENT"] !== "synthetic_demo" ||
      !tokenKey ||
      !/^[A-Za-z0-9_-]{43,}$/u.test(tokenKey) ||
      Buffer.from(tokenKey, "base64url").byteLength < 32
    ) {
      throw new Error("LOCAL_SELF_HOSTED_AUTH_CONFIGURATION_INVALID");
    }
  } else if (tokenKey) {
    throw new Error("AUTH_SECRET_WITH_AUTH_DISABLED");
  }
}

function hasLegacyManagedAuthConfiguration(environment: NodeJS.ProcessEnv): boolean {
  const legacyKeys = [
    ["CLERK", "PUBLISHABLE", "KEY"].join("_"),
    ["CLERK", "SECRET", "KEY"].join("_"),
    ["RENTPROOF", "CLERK", "FRONTEND", "ORIGIN"].join("_"),
    ["RENTPROOF", "CLERK", "HOBBY", "CONFIRMED"].join("_"),
    ["RENTPROOF", "CLERK", "EMAIL", "PASSWORD", "CONFIRMED"].join("_"),
    ["RENTPROOF", "CLERK", "EMAIL", "DELIVERY", "CONFIRMED"].join("_"),
    ["RENTPROOF", "CLERK", "SMS", "DISABLED", "CONFIRMED"].join("_"),
    ["RENTPROOF", "CLERK", "ORIGIN", "CONFIRMED"].join("_"),
  ];
  return legacyKeys.some((key) => Boolean(environment[key]) && environment[key] !== "false");
}

function parseCsv(value: string): readonly string[] {
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !entry || entry === "*" || entry === "null")) {
    throw new Error("ENV_ALLOWLIST_INVALID");
  }
  return entries;
}
