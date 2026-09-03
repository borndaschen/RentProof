import { beforeEach, describe, expect, it, vi } from "vitest";

const environment = {
  RENTPROOF_LLM_MODE: "live" as const,
  RENTPROOF_DEPLOYMENT_PROFILE: "local_development" as const,
  OPENAI_PROJECT_LIMITS_CONFIRMED: "false" as const,
  RENTPROOF_AUTH_MODE: "synthetic" as const,
  RENTPROOF_RULE_PROFILE: "p0" as "p0" | "p1",
};

vi.mock("@/server/env", () => ({
  getServerEnvironment: () => environment,
}));

describe("GET /api/runtime-status", () => {
  beforeEach(() => {
    environment.RENTPROOF_LLM_MODE = "live";
    environment.RENTPROOF_DEPLOYMENT_PROFILE = "local_development";
    environment.OPENAI_PROJECT_LIMITS_CONFIRMED = "false";
    environment.RENTPROOF_RULE_PROFILE = "p0";
  });

  it("returns only the safe runtime projection and disables caching", async () => {
    const { GET } = await import("./route");
    const response = GET();
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toEqual({
      schemaVersion: "rentproof.runtime-status.v1",
      llmMode: "live",
      deploymentProfile: "local_development",
      transport: "http",
      dataPolicy: "synthetic_only",
      projectLimits: "unverified",
      authMode: "synthetic",
      ruleProfile: "p0",
    });
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|secret|credential|model/iu);
  });
});
