import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  actor: vi.fn(),
  status: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/server/auth/current-actor", () => ({ resolveCurrentCaseActor: mocks.actor }));
vi.mock("@/server/auth/request-guard", () => ({
  validateSelfHostedAuthMutation: mocks.guard,
  validateSelfHostedAuthRead: mocks.guard,
}));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({ RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo" }),
}));
vi.mock("@/server/real-demo", () => ({
  getRealDemoRuntime: async () => ({
    processing: { service: { status: mocks.status, confirm: mocks.confirm, cancel: mocks.cancel } },
  }),
}));
import { GET, POST, DELETE } from "./route";

const actor = {
  kind: "guest",
  guestId: "guest_00000000000000001",
  guestSessionId: "guest_session_000000001",
};
const context = {
  params: Promise.resolve({
    caseId: "case_000000000000000001",
    artifactId: "artifact_000000000000001",
  }),
};
function request(method = "GET", body?: string) {
  return new Request("https://127.0.0.1:3443/api/real-cases/case/processing/artifact", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockReturnValue(true);
  mocks.actor.mockResolvedValue(actor);
  mocks.status.mockResolvedValue({ state: "queued" });
  mocks.confirm.mockResolvedValue({ kind: "contract_pdf" });
  mocks.cancel.mockResolvedValue(undefined);
});
describe("owner-scoped processing routes", () => {
  it("polls without extending account idle expiry and disables caching", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.actor).toHaveBeenCalledWith(expect.any(Request), false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("requires explicit confirmation and server ID instead of accepting client text", async () => {
    expect(
      (
        await POST(
          request(
            "POST",
            JSON.stringify({
              confirmationId: "confirmation_00000000001",
              explicitlyConfirmed: true,
              pages: [{ text: "injected" }],
            }),
          ),
          context,
        )
      ).status,
    ).toBe(400);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(
      (
        await POST(
          request(
            "POST",
            JSON.stringify({
              confirmationId: "confirmation_00000000001",
              explicitlyConfirmed: true,
            }),
          ),
          context,
        )
      ).status,
    ).toBe(201);
    expect(mocks.confirm).toHaveBeenCalledWith(
      actor,
      "case_000000000000000001",
      "artifact_000000000000001",
      "confirmation_00000000001",
    );
  });
  it("cancels through the same owner and CSRF gate", async () => {
    expect((await DELETE(request("DELETE", "{}"), context)).status).toBe(204);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    mocks.guard.mockReturnValue(false);
    expect((await DELETE(request("DELETE", "{}"), context)).status).toBe(404);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
  it("rejects oversize and malformed input before invoking confirmation", async () => {
    expect((await POST(request("POST", " ".repeat(1_025)), context)).status).toBe(400);
    expect((await POST(request("POST", "\0"), context)).status).toBe(400);
    expect((await POST(request("POST", "{"), context)).status).toBe(400);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each(["OCR_CONFIRMATION_USED", "OCR_CONFIRMATION_EXPIRED", "OCR_CONFIRMATION_STALE"])(
    "preserves %s as a separate conflict",
    async (code) => {
      mocks.confirm.mockRejectedValueOnce(new Error(code));
      const response = await POST(
        request(
          "POST",
          JSON.stringify({ confirmationId: "confirmation_00000000001", explicitlyConfirmed: true }),
        ),
        context,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code } });
    },
  );
  it("does not reveal another owner's candidate or internal failure detail", async () => {
    mocks.status.mockRejectedValueOnce(new Error("PROCESSING_NOT_FOUND_OR_FORBIDDEN"));
    expect((await GET(request(), context)).status).toBe(404);
    mocks.status.mockRejectedValueOnce(new Error("private database message"));
    expect(await (await GET(request(), context)).json()).toEqual({
      error: { code: "PROCESSING_UNAVAILABLE" },
    });
    mocks.actor.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(401);
  });
});
