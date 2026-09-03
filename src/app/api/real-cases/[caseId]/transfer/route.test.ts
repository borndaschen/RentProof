import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  transfer: vi.fn(),
  actors: vi.fn(),
  environment: {
    RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo",
    RENTPROOF_AUTH_MODE: "self_hosted",
    RENTPROOF_PUBLIC_ORIGIN: "https://192.168.1.20:3443",
    RENTPROOF_INTERNAL_PROXY_TOKEN: "p".repeat(43),
    allowedHosts: ["192.168.1.20:3443"],
    allowedOrigins: ["https://192.168.1.20:3443"],
  },
}));

vi.mock("@/server/env", () => ({ getServerEnvironment: () => mocks.environment }));
vi.mock("@/server/auth/current-actor", () => ({
  resolveCurrentTransferActors: mocks.actors,
}));
vi.mock("@/server/real-demo", () => ({
  getRealDemoRuntime: async () => ({ service: { transferGuestCase: mocks.transfer } }),
}));

import { POST } from "./route";

const csrf = "c".repeat(43);
const caseId = "case_abcdefghijklmnopqrstuvwxyz1234567890";

function request(body: unknown): Request {
  return new Request(`https://192.168.1.20:3443/api/real-cases/${caseId}/transfer`, {
    method: "POST",
    headers: {
      host: "192.168.1.20:3443",
      origin: "https://192.168.1.20:3443",
      "content-type": "application/json",
      "x-rentproof-network-verified": "p".repeat(43),
      "x-rentproof-csrf": csrf,
      cookie: `__Host-rentproof_csrf=${csrf}`,
    },
    body: JSON.stringify(body),
  });
}

describe("guest case transfer route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actors.mockResolvedValue({
      user: { kind: "user", userId: "user_a", sessionId: "session_a" },
      guest: { kind: "guest", guestId: "guest_a", guestSessionId: "guest_session_a" },
      reverified: true,
    });
    mocks.transfer.mockResolvedValue(undefined);
  });

  it("requires the explicit phrase and transfers with both current actors", async () => {
    const response = await POST(request({ confirmation: "SAVE_GUEST_CASE_TO_ACCOUNT" }), {
      params: Promise.resolve({ caseId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "guest" }),
      expect.objectContaining({ kind: "user" }),
      caseId,
      "SAVE_GUEST_CASE_TO_ACCOUNT",
    );
    expect(
      (
        await POST(request({ confirmation: "yes" }), {
          params: Promise.resolve({ caseId }),
        })
      ).status,
    ).toBe(400);
  });

  it("requires recent reverification and never reaches the service otherwise", async () => {
    mocks.actors.mockResolvedValueOnce({
      user: { kind: "user", userId: "user_a", sessionId: "session_a" },
      guest: { kind: "guest", guestId: "guest_a", guestSessionId: "guest_session_a" },
      reverified: false,
    });
    const response = await POST(request({ confirmation: "SAVE_GUEST_CASE_TO_ACCOUNT" }), {
      params: Promise.resolve({ caseId }),
    });
    expect(response.status).toBe(403);
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
});
