import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  actors: vi.fn(),
  guard: vi.fn(() => true),
  deleteCase: vi.fn(),
}));
vi.mock("@/server/auth/current-actor", () => ({ resolveCurrentCaseActors: mocks.actors }));
vi.mock("@/server/auth/request-guard", () => ({
  validateSelfHostedAuthMutation: mocks.guard,
}));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({ RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo" }),
}));
vi.mock("@/server/real-demo", () => ({
  getRealDemoRuntime: async () => ({ service: { deleteCase: mocks.deleteCase } }),
}));

import { DELETE } from "./route";

const context = {
  params: Promise.resolve({ caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" }),
};
const request = () =>
  new Request("https://127.0.0.1:3443/api/real-cases/case", { method: "DELETE" });

describe("DELETE real case", () => {
  beforeEach(() => {
    mocks.guard.mockReset().mockReturnValue(true);
    mocks.deleteCase.mockReset();
    mocks.actors.mockReset().mockResolvedValue({
      account: {
        kind: "user",
        userId: "user_owner_000000000001",
        sessionId: "session_00000000000001",
      },
      guest: {
        kind: "guest",
        guestId: "guest_owner_00000000001",
        guestSessionId: "guest_session_000000001",
      },
    });
  });

  it("falls back to the still-owning guest after cross-tab account login", async () => {
    mocks.deleteCase
      .mockRejectedValueOnce(new Error("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN"))
      .mockResolvedValueOnce(undefined);
    const response = await DELETE(request(), context);
    expect(response.status).toBe(204);
    expect(mocks.deleteCase).toHaveBeenCalledTimes(2);
    expect(mocks.deleteCase.mock.calls[1]?.[0]).toMatchObject({ kind: "guest" });
  });

  it("does not try another owner after a material deletion failure", async () => {
    mocks.deleteCase.mockRejectedValueOnce(new Error("REAL_DEMO_STORAGE_FAILED"));
    const response = await DELETE(request(), context);
    expect(response.status).toBe(503);
    expect(mocks.deleteCase).toHaveBeenCalledTimes(1);
  });

  it("fails closed before owner resolution when the request guard rejects", async () => {
    mocks.guard.mockReturnValueOnce(false);
    expect((await DELETE(request(), context)).status).toBe(404);
    expect(mocks.actors).not.toHaveBeenCalled();
  });
});
