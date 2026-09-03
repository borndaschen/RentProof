import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  environment: {
    RENTPROOF_AUTH_MODE: "self_hosted",
    RENTPROOF_EMAIL_DELIVERY_MODE: "local_synthetic",
    RENTPROOF_DEPLOYMENT_PROFILE: "local_development",
    RENTPROOF_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
    allowedHosts: ["127.0.0.1:3000"],
    allowedOrigins: ["http://127.0.0.1:3000"],
  },
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  register: vi.fn(),
  verifyEmail: vi.fn(),
  authenticate: vi.fn(),
  resolveSession: vi.fn(),
  logout: vi.fn(),
  requestPasswordReset: vi.fn(),
  completePasswordReset: vi.fn(),
  digestPreAuthContext: vi.fn(),
  consumeLatestVerificationToken: vi.fn(),
  consumeLatestResetToken: vi.fn(),
}));

vi.mock("@/server/env", () => ({ getServerEnvironment: () => mocks.environment }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
    delete: mocks.cookieDelete,
  }),
}));
vi.mock("@/server/auth/runtime", () => ({
  getSelfHostedAuthRuntime: async () => ({
    service: {
      register: mocks.register,
      verifyEmail: mocks.verifyEmail,
      authenticate: mocks.authenticate,
      resolveSession: mocks.resolveSession,
      logout: mocks.logout,
      requestPasswordReset: mocks.requestPasswordReset,
      completePasswordReset: mocks.completePasswordReset,
    },
    digestPreAuthContext: mocks.digestPreAuthContext,
    outbox: {
      consumeLatestVerificationToken: mocks.consumeLatestVerificationToken,
      consumeLatestResetToken: mocks.consumeLatestResetToken,
    },
  }),
}));

import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { POST as completeReset } from "./password-reset/complete/route";
import { POST as requestReset } from "./password-reset/request/route";
import { POST as register } from "./register/route";
import { POST as verifyRegistration } from "./registration/verify/route";
import { GET as session } from "./session/route";
import { POST as readDevMailbox } from "./dev-mailbox/route";
import { selfHostedAuthRateLimiter } from "@/server/auth/rate-limit";

const csrf = "c".repeat(43);
const sessionToken = "s".repeat(43);

function mutation(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      cookie: `rentproof_csrf_dev=${csrf}; rentproof_account_dev=${sessionToken}; rentproof_preauth_dev=${"p".repeat(43)}`,
      "x-rentproof-csrf": csrf,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("self-hosted auth HTTP routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selfHostedAuthRateLimiter.reset();
    mocks.environment.RENTPROOF_AUTH_MODE = "self_hosted";
    mocks.environment.RENTPROOF_DEPLOYMENT_PROFILE = "local_development";
    mocks.environment.RENTPROOF_EMAIL_DELIVERY_MODE = "local_synthetic";
    mocks.register.mockResolvedValue({ status: "accepted" });
    mocks.verifyEmail.mockResolvedValue({ status: "verified" });
    mocks.authenticate.mockResolvedValue({ status: "invalid_credentials" });
    mocks.resolveSession.mockResolvedValue({ status: "signed_out" });
    mocks.logout.mockResolvedValue(undefined);
    mocks.requestPasswordReset.mockResolvedValue({ status: "accepted" });
    mocks.completePasswordReset.mockResolvedValue({ status: "invalid_or_expired" });
    mocks.digestPreAuthContext.mockReturnValue("d".repeat(64));
    mocks.consumeLatestVerificationToken.mockReturnValue(null);
    mocks.consumeLatestResetToken.mockReturnValue(null);
  });

  it("keeps passive session polling from extending a seven-day cookie", async () => {
    mocks.resolveSession.mockResolvedValue({
      status: "authenticated",
      actor: { kind: "user", userId: "user_a", sessionId: "session_a" },
      reverified: false,
    });
    const response = await session(
      new Request("http://127.0.0.1:3000/api/auth/session", {
        headers: { host: "127.0.0.1:3000", cookie: `rentproof_account_dev=${sessionToken}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.resolveSession).toHaveBeenCalledWith(sessionToken, false);
    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "rentproof_csrf_dev" }),
    );
    expect(mocks.cookieSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "rentproof_account_dev" }),
    );
  });

  it("accepts the exact Next 16 synthesized forwarding shape but rejects a spoof mismatch", async () => {
    mocks.resolveSession.mockResolvedValue({ status: "signed_out" });
    const safeHeaders = {
      host: "127.0.0.1:3000",
      "x-forwarded-host": "127.0.0.1:3000",
      "x-forwarded-proto": "http",
      "x-forwarded-port": "3000",
      "x-forwarded-for": "127.0.0.1",
    };
    const safe = await session(
      new Request("http://127.0.0.1:3000/api/auth/session", { headers: safeHeaders }),
    );
    expect(safe.status).toBe(200);
    expect(mocks.resolveSession).toHaveBeenCalledOnce();

    mocks.resolveSession.mockClear();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spoofed = await session(
      new Request("http://127.0.0.1:3000/api/auth/session", {
        headers: { ...safeHeaders, "x-forwarded-host": "evil.invalid:3000" },
      }),
    );
    expect(spoofed.status).toBe(404);
    expect(mocks.resolveSession).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith("AUTH_READ_REJECTED_NETWORK_FORWARDED_HOST_MISMATCH");
    warning.mockRestore();
  });

  it("sets only a HttpOnly Strict seven-day account cookie after valid login", async () => {
    mocks.authenticate.mockResolvedValue({
      status: "authenticated",
      actor: { kind: "user", userId: "user_a", sessionId: "session_a" },
      cookie: { token: sessionToken, maxAgeSeconds: 604_800 },
    });
    const response = await login(
      mutation("/api/auth/login", { email: "renter@example.test", password: "correct-password" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.cookieSet).toHaveBeenCalledWith({
      name: "rentproof_account_dev",
      value: sessionToken,
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
      maxAge: 604_800,
      expires: expect.any(Date),
    });
  });

  it("uses indistinguishable accepted responses for registration verification and reset", async () => {
    const code = "v".repeat(43);
    const responses = await Promise.all([
      register(
        mutation("/api/auth/register", {
          email: "new@example.test",
          password: "new-password-12",
          demoPolicyAcknowledged: true,
        }),
      ),
      verifyRegistration(mutation("/api/auth/registration/verify", { code })),
      requestReset(mutation("/api/auth/password-reset/request", { email: "nobody@example.test" })),
      completeReset(
        mutation("/api/auth/password-reset/complete", {
          code,
          newPassword: "replacement-password",
        }),
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([202, 202, 202, 202]);
    const bodies = await Promise.all(responses.map((response) => response.text()));
    expect(new Set(bodies).size).toBe(1);
    expect(bodies.join(" ")).not.toMatch(/email|user|token|code|exist|password/iu);
  });

  it("returns the same login response for unknown accounts and wrong passwords", async () => {
    const first = await login(
      mutation("/api/auth/login", { email: "unknown@example.test", password: "wrong-password" }),
    );
    const second = await login(
      mutation("/api/auth/login", { email: "known@example.test", password: "wrong-password" }),
    );
    expect(first.status).toBe(401);
    expect(await first.text()).toBe(await second.text());
  });

  it("revokes server state and clears the cookie on logout", async () => {
    const response = await logout(mutation("/api/auth/logout", {}));
    expect(response.status).toBe(204);
    expect(mocks.logout).toHaveBeenCalledWith(sessionToken);
    expect(mocks.cookieSet).toHaveBeenCalledWith({
      name: "rentproof_account_dev",
      value: "",
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  });

  it("returns 404 without touching runtime for LAN HTTP", async () => {
    mocks.environment.RENTPROOF_DEPLOYMENT_PROFILE = "lan_development";
    const response = await login(
      mutation("/api/auth/login", { email: "renter@example.test", password: "correct-password" }),
    );
    expect(response.status).toBe(404);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("rejects CSRF, cross-origin, oversized, and JSON-smuggling input before authentication", async () => {
    const badCsrf = await login(
      mutation(
        "/api/auth/login",
        { email: "renter@example.test", password: "correct-password" },
        { "x-rentproof-csrf": "x".repeat(43) },
      ),
    );
    const smuggled = await login(
      mutation("/api/auth/login", {
        email: "renter@example.test",
        password: "correct-password",
        role: "admin",
      }),
    );
    const oversized = await login(
      mutation(
        "/api/auth/login",
        { email: "renter@example.test", password: "correct-password" },
        { "content-length": "4097" },
      ),
    );
    expect([badCsrf.status, smuggled.status, oversized.status]).toEqual([404, 400, 400]);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("binds the localhost outbox to the requesting browser pre-auth context", async () => {
    const browserA = "a".repeat(43);
    const digestA = "1".repeat(64);
    mocks.digestPreAuthContext.mockImplementation((raw: string) =>
      raw === browserA ? digestA : "2".repeat(64),
    );
    mocks.consumeLatestVerificationToken.mockReturnValue("v".repeat(43));
    const body = new URLSearchParams({
      csrf,
      email: "new@example.test",
      kind: "verification",
    }).toString();
    const response = await readDevMailbox(
      new Request("http://127.0.0.1:3000/api/auth/dev-mailbox", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/x-www-form-urlencoded",
          cookie: `rentproof_csrf_dev=${csrf}; rentproof_preauth_dev=${browserA}`,
        },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.consumeLatestVerificationToken).toHaveBeenCalledWith("new@example.test", digestA);
    expect(await response.text()).toContain("v".repeat(43));
  });

  it("never exposes the synthetic mailbox in secure LAN or Gmail delivery mode", async () => {
    const request = new Request("http://127.0.0.1:3000/api/auth/dev-mailbox", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf,
        email: "new@example.test",
        kind: "verification",
      }),
    });
    mocks.environment.RENTPROOF_DEPLOYMENT_PROFILE = "lan_secure_demo";
    expect((await readDevMailbox(request.clone())).status).toBe(404);
    mocks.environment.RENTPROOF_DEPLOYMENT_PROFILE = "local_development";
    mocks.environment.RENTPROOF_EMAIL_DELIVERY_MODE = "personal_gmail_api";
    expect((await readDevMailbox(request)).status).toBe(404);
    expect(mocks.consumeLatestVerificationToken).not.toHaveBeenCalled();
  });

  it("distinguishes infrastructure failure from an invalid verification challenge", async () => {
    const code = "v".repeat(43);
    mocks.verifyEmail.mockResolvedValueOnce({ status: "invalid_or_expired" });
    expect(
      (await verifyRegistration(mutation("/api/auth/registration/verify", { code }))).status,
    ).toBe(202);
    mocks.verifyEmail.mockRejectedValueOnce(new Error("database unavailable"));
    const unavailable = await verifyRegistration(
      mutation("/api/auth/registration/verify", { code }),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("database unavailable");
  });

  it("logs only an allowlisted register failure code and redacts error and input details", async () => {
    const privateError = Object.assign(
      new Error("new@example.test private-password C:\\secret\\stack"),
      { code: "42501" },
    );
    mocks.register.mockRejectedValueOnce(privateError);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await register(
      mutation("/api/auth/register", {
        email: "new@example.test",
        password: "private-password",
        demoPolicyAcknowledged: true,
      }),
    );
    expect(response.status).toBe(503);
    expect(errorLog).toHaveBeenCalledWith("AUTH_REGISTER_FAILED_POSTGRES_INSUFFICIENT_PRIVILEGE");
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toMatch(/new@example|private-password|secret|stack|42501/iu);
    errorLog.mockRestore();
  });
});
