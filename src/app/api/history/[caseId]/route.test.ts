import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ getCurrentActorCaseHistory: vi.fn() }));
vi.mock("@/server/history/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/history/runtime")>()),
  getCurrentActorCaseHistory: mocks.getCurrentActorCaseHistory,
}));

describe("GET /api/history/:caseId", () => {
  beforeEach(() => mocks.getCurrentActorCaseHistory.mockReset());

  it("returns owned detail without auth or database identifiers", async () => {
    mocks.getCurrentActorCaseHistory.mockResolvedValue({
      caseId: "case_owned_by_a_00000001",
      displayName: "虛構套房 A",
      status: "ready",
      revision: 2,
      sourceMode: "fixture",
      createdAt: "2026-09-03T07:00:00.000Z",
      updatedAt: "2026-09-03T08:00:00.000Z",
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://127.0.0.1/api/history/x"), {
      params: Promise.resolve({ caseId: "case_owned_by_a_00000001" }),
    });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toMatch(/owner|clerk|session|database|secret/iu);
  });
});
