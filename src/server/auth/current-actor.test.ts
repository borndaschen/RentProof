import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  accountResolve: vi.fn(),
  guestResolve: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({
    RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo",
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet }),
}));
vi.mock("./runtime", () => ({
  getSelfHostedAuthRuntime: async () => ({
    service: { resolveSession: mocks.accountResolve },
  }),
}));
vi.mock("./guest-session", () => ({
  GUEST_SESSION_COOKIE: "__Host-rentproof_guest",
  getGuestSessionRuntime: async () => ({ resolve: mocks.guestResolve }),
}));

import {
  CurrentActorResolutionError,
  resolveCurrentCaseActor,
  resolveCurrentTransferActors,
} from "./current-actor";

const request = (cookie: string) =>
  new Request("https://192.168.1.20:3443/api/real-cases", {
    headers: { cookie },
  });

describe("resolveCurrentCaseActor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountResolve.mockResolvedValue({ status: "signed_out" });
    mocks.guestResolve.mockResolvedValue(null);
  });

  it("falls back to the current fixed-expiry guest session when no account is active", async () => {
    const guest = {
      kind: "guest",
      guestId: "guest_abcdefghijklmnopqrstuvwxyz12345",
      guestSessionId: "guest_session_abcdefghijklmnopqrstuv",
    } as const;
    mocks.guestResolve.mockResolvedValue(guest);
    const token = "g".repeat(43);

    await expect(
      resolveCurrentCaseActor(request(`__Host-rentproof_guest=${token}`)),
    ).resolves.toEqual(guest);
    expect(mocks.accountResolve).toHaveBeenCalledWith(undefined, true);
    expect(mocks.guestResolve).toHaveBeenCalledWith(token);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("prefers an authenticated account and does not resolve the guest cookie", async () => {
    const user = { kind: "user", userId: "user_a", sessionId: "session_a" } as const;
    mocks.accountResolve.mockResolvedValue({
      status: "authenticated",
      actor: user,
      reverified: false,
      refreshCookie: { token: "s".repeat(43), maxAgeSeconds: 604_800 },
    });

    await expect(
      resolveCurrentCaseActor(
        request(
          `__Host-rentproof_account=${"a".repeat(43)}; __Host-rentproof_guest=${"g".repeat(43)}`,
        ),
      ),
    ).resolves.toEqual(user);
    expect(mocks.guestResolve).not.toHaveBeenCalled();
  });

  it("fails closed when guest resolution is unavailable", async () => {
    mocks.guestResolve.mockRejectedValue(new Error("database unavailable"));
    await expect(resolveCurrentCaseActor(request(""))).rejects.toBeInstanceOf(
      CurrentActorResolutionError,
    );
  });

  it("resolves both live sessions and preserves recent reverification for transfer", async () => {
    const user = { kind: "user", userId: "user_a", sessionId: "session_a" } as const;
    const guest = {
      kind: "guest",
      guestId: "guest_abcdefghijklmnopqrstuvwxyz12345",
      guestSessionId: "guest_session_abcdefghijklmnopqrstuv",
    } as const;
    mocks.accountResolve.mockResolvedValue({
      status: "authenticated",
      actor: user,
      reverified: true,
      refreshCookie: { token: "a".repeat(43), maxAgeSeconds: 604_800 },
    });
    mocks.guestResolve.mockResolvedValue(guest);
    await expect(
      resolveCurrentTransferActors(
        request(
          `__Host-rentproof_account=${"a".repeat(43)}; __Host-rentproof_guest=${"g".repeat(43)}`,
        ),
      ),
    ).resolves.toEqual({ user, guest, reverified: true });
    expect(mocks.guestResolve).toHaveBeenCalledWith("g".repeat(43));
  });
});
