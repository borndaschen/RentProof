import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const base = {
  RENTPROOF_DEPLOYMENT_PROFILE: "local_development",
  RENTPROOF_BIND_HOST: "127.0.0.1",
  RENTPROOF_PORT: "3000",
  RENTPROOF_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  RENTPROOF_ALLOWED_HOSTS: "127.0.0.1:3000",
  RENTPROOF_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
  RENTPROOF_ALLOW_REAL_DATA: "false",
  RENTPROOF_LLM_MODE: "fixture",
  OPENAI_PROJECT_LIMITS_CONFIRMED: "false",
  RENTPROOF_DEMO_CASE_VERSION: "golden-v1",
  OPENAI_CONVERSATION_MODEL: "gpt-5.6-luna",
  OPENAI_CONVERSATION_REASONING_EFFORT: "low",
  OPENAI_EVIDENCE_MODEL: "gpt-5.6-terra",
  OPENAI_EVIDENCE_REASONING_EFFORT: "medium",
  OPENAI_SERVICE_TIER: "default",
} as const;

const tokenKey = Buffer.alloc(32, 7).toString("base64url");

async function load(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of [
    "RENTPROOF_AUTH_MODE",
    "RENTPROOF_RULE_PROFILE",
    "RENTPROOF_AUTH_TOKEN_KEY",
    "RENTPROOF_DATABASE_ADAPTER",
    "RENTPROOF_DATABASE_ROLE",
    "RENTPROOF_DATABASE_ENVIRONMENT",
    "CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "RENTPROOF_CLERK_FRONTEND_ORIGIN",
  ])
    delete process.env[key];
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else vi.stubEnv(key, value);
  }
  return (await import("./env")).getServerEnvironment();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("self-hosted authentication deployment gate", () => {
  it("defaults to synthetic auth without an account secret", async () => {
    expect((await load({ RENTPROOF_AUTH_MODE: undefined })).RENTPROOF_AUTH_MODE).toBe("synthetic");
  });

  it("defaults the server-only official-rule profile to p0 and accepts explicit p1", async () => {
    expect((await load({ RENTPROOF_RULE_PROFILE: undefined })).RENTPROOF_RULE_PROFILE).toBe("p0");
    expect((await load({ RENTPROOF_RULE_PROFILE: "p1" })).RENTPROOF_RULE_PROFILE).toBe("p1");
    await expect(load({ RENTPROOF_RULE_PROFILE: "all" })).rejects.toThrow();
  });

  it("allows complete self-hosted synthetic development configuration only on loopback", async () => {
    const environment = await load({
      RENTPROOF_AUTH_MODE: "self_hosted",
      RENTPROOF_AUTH_TOKEN_KEY: tokenKey,
      RENTPROOF_DATABASE_ADAPTER: "postgres",
      RENTPROOF_DATABASE_ROLE: "app",
      RENTPROOF_DATABASE_ENVIRONMENT: "synthetic_demo",
    });
    expect(environment.RENTPROOF_AUTH_MODE).toBe("self_hosted");
  });

  it("rejects self-hosted auth and dormant auth secrets from LAN HTTP", async () => {
    await expect(
      load({
        RENTPROOF_DEPLOYMENT_PROFILE: "lan_development",
        RENTPROOF_BIND_HOST: "192.168.1.20",
        RENTPROOF_PUBLIC_ORIGIN: "http://192.168.1.20:3000",
        RENTPROOF_ALLOWED_HOSTS: "192.168.1.20:3000",
        RENTPROOF_ALLOWED_ORIGINS: "http://192.168.1.20:3000",
        RENTPROOF_AUTH_MODE: "self_hosted",
        RENTPROOF_AUTH_TOKEN_KEY: tokenKey,
      }),
    ).rejects.toThrow("LAN_AUTH_FORBIDDEN");
  });

  it("rejects the HMAC key when auth is disabled", async () => {
    await expect(
      load({ RENTPROOF_AUTH_MODE: "synthetic", RENTPROOF_AUTH_TOKEN_KEY: tokenKey }),
    ).rejects.toThrow("AUTH_SECRET_WITH_AUTH_DISABLED");
  });

  it.each([
    ["missing token key", { RENTPROOF_AUTH_TOKEN_KEY: undefined }],
    ["weak token key", { RENTPROOF_AUTH_TOKEN_KEY: "too-short" }],
    ["disabled database", { RENTPROOF_DATABASE_ADAPTER: "disabled" }],
    ["migration role", { RENTPROOF_DATABASE_ROLE: "migration" }],
    ["test database", { RENTPROOF_DATABASE_ENVIRONMENT: "local_test" }],
  ])("rejects incomplete self-hosted config: %s", async (_label, changed) => {
    await expect(
      load({
        RENTPROOF_AUTH_MODE: "self_hosted",
        RENTPROOF_AUTH_TOKEN_KEY: tokenKey,
        RENTPROOF_DATABASE_ADAPTER: "postgres",
        RENTPROOF_DATABASE_ROLE: "app",
        RENTPROOF_DATABASE_ENVIRONMENT: "synthetic_demo",
        ...changed,
      }),
    ).rejects.toThrow("LOCAL_SELF_HOSTED_AUTH_CONFIGURATION_INVALID");
  });

  it("rejects all legacy managed-auth credentials instead of silently ignoring them", async () => {
    await expect(
      load({
        RENTPROOF_AUTH_MODE: "synthetic",
        CLERK_SECRET_KEY: "legacy-secret-must-not-be-used",
      }),
    ).rejects.toThrow("LEGACY_MANAGED_AUTH_CONFIGURATION_FORBIDDEN");
  });
});
