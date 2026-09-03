import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const safeDevelopmentEnvironment = {
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadEnvironment(overrides: Record<string, string>) {
  for (const [key, value] of Object.entries({ ...safeDevelopmentEnvironment, ...overrides })) {
    vi.stubEnv(key, value);
  }
  const { getServerEnvironment } = await import("@/server/env");
  return getServerEnvironment();
}

describe("HTTP development profile boundary", () => {
  it("rejects real-data enablement under every P0 HTTP profile", async () => {
    await expect(loadEnvironment({ RENTPROOF_ALLOW_REAL_DATA: "true" })).rejects.toThrowError();
  });

  it("does not admit a production profile through the HTTP development launcher", async () => {
    await expect(
      loadEnvironment({
        RENTPROOF_DEPLOYMENT_PROFILE: "production",
        RENTPROOF_PUBLIC_ORIGIN: "http://rentproof.example",
      }),
    ).rejects.toThrowError();
  });

  it("keeps self-hosted account mutations disabled on LAN", async () => {
    const { validateSelfHostedAuthMutation } = await import("@/server/auth/request-guard");
    const request = new Request("http://192.168.1.20:3000/api/auth/login", {
      method: "POST",
      headers: {
        host: "192.168.1.20:3000",
        origin: "http://192.168.1.20:3000",
        "content-type": "application/json",
      },
    });
    expect(
      validateSelfHostedAuthMutation(request, {
        RENTPROOF_AUTH_MODE: "synthetic",
        RENTPROOF_DEPLOYMENT_PROFILE: "lan_development",
        RENTPROOF_PUBLIC_ORIGIN: "http://192.168.1.20:3000",
        allowedHosts: ["192.168.1.20:3000"],
        allowedOrigins: ["http://192.168.1.20:3000"],
      }),
    ).toBe(false);
  });
});
