import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  AUTH_REQUEST_MAX_BYTES,
  classifyAuthRegisterFailure,
  ensurePreAuthCookie,
  guardAuthRead,
  readBoundedAuthJson,
  setSessionCookie,
  type AuthCookieStore,
} from "./http";

const environment = {
  RENTPROOF_AUTH_MODE: "self_hosted",
  RENTPROOF_DEPLOYMENT_PROFILE: "local_development",
  RENTPROOF_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  allowedHosts: ["127.0.0.1:3000"],
  allowedOrigins: ["http://127.0.0.1:3000"],
} as never;

afterEach(() => vi.useRealTimers());

describe("self-hosted auth HTTP utilities", () => {
  it("moves both Max-Age and Expires forward on a later eligible activity", () => {
    const set = vi.fn();
    const cookieStore = { set, get: vi.fn(), delete: vi.fn() } as AuthCookieStore;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T00:00:00.000Z"));
    setSessionCookie(cookieStore, environment, { token: "s".repeat(43), maxAgeSeconds: 604_800 });
    const first = set.mock.calls[0]![0] as { expires: Date; maxAge: number };
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
    setSessionCookie(cookieStore, environment, { token: "s".repeat(43), maxAgeSeconds: 604_800 });
    const second = set.mock.calls[1]![0] as { expires: Date; maxAge: number };
    expect(first.maxAge).toBe(604_800);
    expect(second.maxAge).toBe(604_800);
    expect(second.expires.getTime() - first.expires.getTime()).toBe(86_400_000);
  });

  it("creates a HttpOnly pre-auth binding and reuses only one valid cookie", () => {
    const set = vi.fn();
    const cookieStore = { set, get: vi.fn(), delete: vi.fn() } as AuthCookieStore;
    const issued = ensurePreAuthCookie(
      new Request("http://127.0.0.1:3000/api/auth/session"),
      cookieStore,
      environment,
    );
    expect(issued).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "rentproof_preauth_dev",
        httpOnly: true,
        sameSite: "strict",
      }),
    );
    set.mockClear();
    expect(
      ensurePreAuthCookie(
        new Request("http://127.0.0.1:3000/api/auth/session", {
          headers: { cookie: `rentproof_preauth_dev=${issued}` },
        }),
        cookieStore,
        environment,
      ),
    ).toBe(issued);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects oversized and invalid UTF-8 bodies without truncation", async () => {
    await expect(
      readBoundedAuthJson(
        new Request("http://127.0.0.1:3000/api/auth/login", {
          method: "POST",
          headers: { "content-length": String(AUTH_REQUEST_MAX_BYTES + 1) },
          body: "{}",
        }),
      ),
    ).rejects.toThrow("AUTH_REQUEST_TOO_LARGE");
    await expect(
      readBoundedAuthJson(
        new Request("http://127.0.0.1:3000/api/auth/login", {
          method: "POST",
          body: new Uint8Array([0xc3, 0x28]),
        }),
      ),
    ).rejects.toThrow();
  });

  it("logs only a stable local diagnostic reason when a read is rejected", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = guardAuthRead(
      new Request("http://127.0.0.1:3000/api/auth/session", {
        headers: {
          host: "127.0.0.1:3000",
          "x-forwarded-host": "attacker.invalid:3000",
          cookie: `rentproof_account_dev=${"s".repeat(43)}`,
        },
      }),
      environment,
      "session",
    );
    expect(response?.status).toBe(404);
    expect(warning).toHaveBeenCalledWith("AUTH_READ_REJECTED_NETWORK_FORWARDED_HOST_MISMATCH");
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/attacker|rentproof_account|ssss/iu);
    warning.mockRestore();
  });

  it.each([
    ["42501", "POSTGRES_INSUFFICIENT_PRIVILEGE"],
    ["23502", "POSTGRES_NOT_NULL_VIOLATION"],
    ["23503", "POSTGRES_FOREIGN_KEY_VIOLATION"],
    ["23505", "POSTGRES_UNIQUE_VIOLATION"],
    ["23514", "POSTGRES_CHECK_VIOLATION"],
    ["42P01", "POSTGRES_UNDEFINED_TABLE"],
    ["42703", "POSTGRES_UNDEFINED_COLUMN"],
  ])("maps allowlisted PostgreSQL SQLSTATE %s to %s", (code, reason) => {
    expect(classifyAuthRegisterFailure(Object.assign(new Error("private detail"), { code }))).toBe(
      reason,
    );
  });

  it("maps error classes to fixed categories without reading message or stack", () => {
    for (const [name, reason] of [
      ["Argon2Error", "PASSWORD_HASHING"],
      ["AuthRuntimeConfigurationError", "CONFIGURATION"],
      ["LocalSyntheticOutboxError", "DELIVERY"],
      ["UnknownPrivateError", "UNKNOWN"],
    ] as const) {
      const error = new Error("secret@example.test password-do-not-log");
      error.name = name;
      error.stack = "C:\\private\\secret-stack";
      expect(classifyAuthRegisterFailure(error)).toBe(reason);
    }
    expect(
      classifyAuthRegisterFailure(
        Object.create(null, {
          code: {
            get: () => {
              throw new Error("getter secret");
            },
          },
        }),
      ),
    ).toBe("UNKNOWN");
  });

  it.each([
    ["INPUT_NORMALIZATION", "REGISTRATION_INPUT_NORMALIZATION"],
    ["PASSWORD_HASH", "REGISTRATION_PASSWORD_HASH"],
    ["ACCOUNT_CREATE", "REGISTRATION_ACCOUNT_CREATE"],
    ["CREDENTIAL_LOOKUP", "REGISTRATION_CREDENTIAL_LOOKUP"],
    ["CHALLENGE_CREATE", "REGISTRATION_CHALLENGE_CREATE"],
    ["DELIVERY", "REGISTRATION_DELIVERY"],
    ["RESPONSE_FLOOR", "REGISTRATION_RESPONSE_FLOOR"],
  ] as const)("maps typed registration phase %s without inspecting cause", (code, reason) => {
    const error = Object.assign(new Error("private data must not be read"), {
      name: "AuthRegistrationError",
      code,
    });
    expect(classifyAuthRegisterFailure(error)).toBe(reason);
  });

  it.each([
    "POSTGRES_INSUFFICIENT_PRIVILEGE",
    "POSTGRES_NOT_NULL_VIOLATION",
    "POSTGRES_FOREIGN_KEY_VIOLATION",
    "POSTGRES_UNIQUE_VIOLATION",
    "POSTGRES_CHECK_VIOLATION",
    "POSTGRES_UNDEFINED_TABLE",
    "POSTGRES_UNDEFINED_COLUMN",
    "POSTGRES_OTHER",
  ] as const)("appends allowlisted account-create database detail %s", (detail) => {
    const error = Object.assign(new Error("must not be inspected"), {
      name: "AuthRegistrationError",
      code: "ACCOUNT_CREATE",
      detail,
    });
    expect(classifyAuthRegisterFailure(error)).toBe(`REGISTRATION_ACCOUNT_CREATE_${detail}`);
  });

  it("rejects forged registration detail and requires the typed error name", () => {
    expect(
      classifyAuthRegisterFailure(
        Object.assign(new Error("private"), {
          name: "AuthRegistrationError",
          code: "ACCOUNT_CREATE",
          detail: "PRIVATE_SQL_TEXT",
        }),
      ),
    ).toBe("REGISTRATION_ACCOUNT_CREATE");
    expect(classifyAuthRegisterFailure({ code: "ACCOUNT_CREATE", detail: "POSTGRES_OTHER" })).toBe(
      "UNKNOWN",
    );
  });
});
