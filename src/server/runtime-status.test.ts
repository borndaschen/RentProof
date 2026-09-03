import { describe, expect, it } from "vitest";
import { createRuntimeStatusProjection } from "./runtime-status";

describe("runtime status safe projection", () => {
  it("projects live mode and an unverified Project limit warning without secrets", () => {
    const projection = createRuntimeStatusProjection({
      RENTPROOF_LLM_MODE: "live",
      RENTPROOF_DEPLOYMENT_PROFILE: "local_development",
      RENTPROOF_ALLOW_REAL_DATA: "false",
      OPENAI_PROJECT_LIMITS_CONFIRMED: "false",
      RENTPROOF_AUTH_MODE: "synthetic",
      RENTPROOF_RULE_PROFILE: "p0",
    });

    expect(projection).toEqual({
      schemaVersion: "rentproof.runtime-status.v1",
      llmMode: "live",
      deploymentProfile: "local_development",
      transport: "http",
      dataPolicy: "synthetic_only",
      projectLimits: "unverified",
      authMode: "synthetic",
      ruleProfile: "p0",
    });
    expect(JSON.stringify(projection)).not.toMatch(/api[_-]?key|secret|credential|model/iu);
  });

  it("projects fixture mode and confirmed operator status", () => {
    expect(
      createRuntimeStatusProjection({
        RENTPROOF_LLM_MODE: "fixture",
        RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo",
        RENTPROOF_ALLOW_REAL_DATA: "true",
        OPENAI_PROJECT_LIMITS_CONFIRMED: "true",
        RENTPROOF_AUTH_MODE: "self_hosted",
        RENTPROOF_RULE_PROFILE: "p1",
      }),
    ).toMatchObject({
      llmMode: "fixture",
      deploymentProfile: "lan_secure_demo",
      transport: "https",
      dataPolicy: "real_data_enabled",
      projectLimits: "confirmed",
      authMode: "self_hosted",
      ruleProfile: "p1",
    });
  });

  it("projects only a safe self-hosted-local label without auth secrets", () => {
    const projection = createRuntimeStatusProjection({
      RENTPROOF_LLM_MODE: "fixture",
      RENTPROOF_DEPLOYMENT_PROFILE: "local_development",
      RENTPROOF_ALLOW_REAL_DATA: "false",
      OPENAI_PROJECT_LIMITS_CONFIRMED: "false",
      RENTPROOF_AUTH_MODE: "self_hosted",
      RENTPROOF_RULE_PROFILE: "p0",
    });
    expect(projection.authMode).toBe("self_hosted");
    expect(JSON.stringify(projection)).not.toMatch(/token|password|email|database/iu);
  });
});
