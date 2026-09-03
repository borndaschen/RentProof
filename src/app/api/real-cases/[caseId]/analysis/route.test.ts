import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIAnalysisError } from "@/adapters/openai/analysis/adapter";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  analyzeRealCase: vi.fn(),
  resolveCurrentCaseActor: vi.fn(),
  validateMutation: vi.fn(() => true),
}));

vi.mock("@/server/real-demo/analysis", () => ({ analyzeRealCase: mocks.analyzeRealCase }));
vi.mock("@/server/auth/current-actor", () => ({
  resolveCurrentCaseActor: mocks.resolveCurrentCaseActor,
}));
vi.mock("@/server/auth/request-guard", () => ({
  validateSelfHostedAuthMutation: mocks.validateMutation,
}));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({
    RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo",
    RENTPROOF_LLM_MODE: "live",
    OPENAI_PROJECT_LIMITS_CONFIRMED: "true",
  }),
}));

import { POST } from "./route";

const actor = {
  kind: "user",
  userId: "user_abcdefghijklmnopqrstuvwxyz123456",
  sessionId: "session_abcdefghijklmnopqrstuvwxyz123",
} as const;
const caseId = "case_abcdefghijklmnopqrstuvwxyz1234567890";

describe("POST /api/real-cases/:caseId/analysis", () => {
  beforeEach(() => {
    process.env["OPENAI_API_KEY"] = "test-only-not-a-real-key";
    mocks.analyzeRealCase.mockReset();
    mocks.resolveCurrentCaseActor.mockReset().mockResolvedValue(actor);
    mocks.validateMutation.mockClear();
  });

  it("keeps provider schema failure distinct and private", async () => {
    mocks.analyzeRealCase.mockRejectedValueOnce(
      new OpenAIAnalysisError("ANALYSIS_PROVIDER_SCHEMA_INVALID", 1, "provider-secret-id"),
    );
    const response = await requestAnalysis();
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: { code: "ANALYSIS_PROVIDER_SCHEMA_INVALID" },
    });
  });

  it("returns bounded Retry-After only for provider or budget throttling", async () => {
    mocks.analyzeRealCase.mockRejectedValueOnce(
      new OpenAIAnalysisError("ANALYSIS_PROVIDER_RATE_LIMITED", 1, null, 429),
    );
    const providerResponse = await requestAnalysis();
    expect(providerResponse.status).toBe(429);
    expect(providerResponse.headers.get("Retry-After")).toBe("30");

    mocks.analyzeRealCase.mockRejectedValueOnce(new Error("REAL_ANALYSIS_BUDGET_EXCEEDED"));
    const budgetResponse = await requestAnalysis();
    expect(budgetResponse.status).toBe(429);
    expect(budgetResponse.headers.get("Retry-After")).toBe("60");
  });

  it("does not misreport invalid artifacts or unknown usage as rate limits", async () => {
    mocks.analyzeRealCase.mockRejectedValueOnce(new Error("REAL_ANALYSIS_ARTIFACT_INVALID"));
    const artifactResponse = await requestAnalysis();
    expect(artifactResponse.status).toBe(422);
    expect(artifactResponse.headers.get("Retry-After")).toBeNull();

    mocks.analyzeRealCase.mockRejectedValueOnce(new Error("REAL_ANALYSIS_BUDGET_USAGE_UNKNOWN"));
    const usageResponse = await requestAnalysis();
    expect(usageResponse.status).toBe(502);
    expect(usageResponse.headers.get("Retry-After")).toBeNull();
  });
});

function requestAnalysis(): Promise<Response> {
  return POST(
    new Request(`https://127.0.0.1:3443/api/real-cases/${caseId}/analysis`, {
      method: "POST",
      headers: { origin: "https://127.0.0.1:3443" },
    }),
    { params: Promise.resolve({ caseId }) },
  );
}
