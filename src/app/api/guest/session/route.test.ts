import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  issue: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({
    RENTPROOF_AUTH_MODE: "self_hosted",
    RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo",
    RENTPROOF_PUBLIC_ORIGIN: "https://192.168.1.20:3443",
    RENTPROOF_INTERNAL_PROXY_TOKEN: "p".repeat(43),
    allowedHosts: ["192.168.1.20:3443"],
    allowedOrigins: ["https://192.168.1.20:3443"],
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet }),
}));
vi.mock("@/server/auth/guest-session", () => ({
  GUEST_SESSION_COOKIE: "__Host-rentproof_guest",
  getGuestSessionRuntime: async () => ({ resolve: mocks.resolve, issue: mocks.issue }),
}));

import { GET } from "./route";

function request(cookie?: string): Request {
  return new Request("https://192.168.1.20:3443/api/guest/session", {
    headers: {
      host: "192.168.1.20:3443",
      "x-rentproof-network-verified": "p".repeat(43),
      ...(cookie ? { cookie } : {}),
    },
  });
}

describe("guest session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue(null);
    mocks.issue.mockResolvedValue({
      actor: {
        kind: "guest",
        guestId: "guest_abcdefghijklmnopqrstuvwxyz12345",
        guestSessionId: "guest_session_abcdefghijklmnopqrstuv",
      },
      rawToken: "g".repeat(43),
    });
  });

  it("issues a Secure HttpOnly Strict cookie with a fixed 24-hour lifetime", async () => {
    const response = await GET(request());
    expect(response.status).toBe(201);
    expect(mocks.cookieSet).toHaveBeenCalledWith({
      name: "__Host-rentproof_guest",
      value: "g".repeat(43),
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 86_400,
      expires: expect.any(Date),
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not slide or replace a still-valid guest session", async () => {
    mocks.resolve.mockResolvedValue({
      kind: "guest",
      guestId: "guest_abcdefghijklmnopqrstuvwxyz12345",
      guestSessionId: "guest_session_abcdefghijklmnopqrstuv",
    });
    const response = await GET(request(`__Host-rentproof_guest=${"e".repeat(43)}`));
    expect(response.status).toBe(200);
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("fails closed when the trusted HTTPS proxy proof is missing", async () => {
    const response = await GET(
      new Request("https://192.168.1.20:3443/api/guest/session", {
        headers: { host: "192.168.1.20:3443" },
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
