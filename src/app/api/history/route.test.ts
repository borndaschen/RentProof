import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ listCurrentActorHistory: vi.fn() }));
vi.mock("@/server/history/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/history/runtime")>()),
  listCurrentActorHistory: mocks.listCurrentActorHistory,
}));

describe("GET /api/history", () => {
  beforeEach(() => mocks.listCurrentActorHistory.mockReset());

  it("returns only the server-projected owner-scoped list", async () => {
    mocks.listCurrentActorHistory.mockResolvedValue([
      {
        caseId: "case_owned_by_a_00000001",
        displayName: "虛構套房 A",
        status: "ready",
        updatedAt: "2026-09-03T08:00:00.000Z",
      },
    ]);
    const { GET } = await import("./route");
    const request = new Request("http://127.0.0.1:3000/api/history");
    const response = await GET(request);
    expect(mocks.listCurrentActorHistory).toHaveBeenCalledWith(request);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: "rentproof.case-history.v1" });
    expect(text).not.toMatch(/clerk|session|secret|password|database/iu);
  });
});
