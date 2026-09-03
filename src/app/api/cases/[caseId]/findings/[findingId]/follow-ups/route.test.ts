import { beforeEach, describe, expect, it, vi } from "vitest";

const applyMock = vi.fn();
vi.mock("@/server/follow-ups", () => ({ applySealedWallFollowUp: applyMock }));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({
    RENTPROOF_DEMO_CASE_VERSION: "golden-v1",
    RENTPROOF_ALLOW_REAL_DATA: "false",
    allowedHosts: ["127.0.0.1:3000"],
    allowedOrigins: ["http://127.0.0.1:3000"],
  }),
}));

const { POST } = await import("./route");

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(
    "http://127.0.0.1:3000/api/cases/golden-v1/findings/finding_wall_follow_up_00001/follow-ups",
    {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
        "idempotency-key": "followup_request_abcdefghij",
        "x-rentproof-csrf": "rentproof-synthetic-follow-up-v1",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function context(caseId = "golden-v1", findingId = "finding_wall_follow_up_00001") {
  return { params: Promise.resolve({ caseId, findingId }) };
}

describe("follow-up route", () => {
  beforeEach(() => {
    applyMock.mockReset();
  });

  it("passes only receipt identity and expected revision to the server-owned follow-up runtime", async () => {
    applyMock.mockResolvedValue({
      ok: true,
      status: 201,
      view: {
        schemaVersion: "rentproof.follow-up-result.v1",
        snapshotId: "snapshot_followup_abcdefghij",
      },
    });
    const response = await POST(
      request({ receiptId: "receipt_followup_abcdefghij", expectedRevision: 0 }),
      context(),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(applyMock).toHaveBeenCalledWith({
      caseId: "golden-v1",
      findingId: "finding_wall_follow_up_00001",
      receiptId: "receipt_followup_abcdefghij",
      expectedRevision: 0,
      idempotencyKey: "followup_request_abcdefghij",
    });
  });

  it("rejects client-reported finding, locator, or status fields", async () => {
    const response = await POST(
      request({
        receiptId: "receipt_followup_abcdefghij",
        expectedRevision: 0,
        status: "supported",
        locator: { artifactId: "attacker-selected" },
      }),
      context(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "FOLLOW_UP_REQUEST_INVALID", retryable: false },
    });
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("enforces the fixed finding, exact origin, CSRF, and idempotency gates", async () => {
    const body = { receiptId: "receipt_followup_abcdefghij", expectedRevision: 0 };
    expect((await POST(request(body), context("golden-v1", "other-finding-00000001"))).status).toBe(
      404,
    );
    expect((await POST(request(body, { origin: "http://evil.invalid" }), context())).status).toBe(
      403,
    );
    expect((await POST(request(body, { "x-rentproof-csrf": "wrong" }), context())).status).toBe(
      403,
    );
    expect((await POST(request(body, { "idempotency-key": "short" }), context())).status).toBe(400);
    expect(applyMock).not.toHaveBeenCalled();
  });
});
