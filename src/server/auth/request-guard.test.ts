import { describe, expect, it } from "vitest";
import {
  AUTH_CSRF_COOKIE_DEV,
  authCookieNames,
  diagnoseSelfHostedAuthRead,
  isSelfHostedAuthRouteEnabled,
  readUniqueCookie,
  validateSelfHostedAuthMutation,
  validateSelfHostedAuthRead,
} from "./request-guard";

const token = "a".repeat(43);
const local = {
  RENTPROOF_AUTH_MODE: "self_hosted",
  RENTPROOF_DEPLOYMENT_PROFILE: "local_development",
  RENTPROOF_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  allowedHosts: ["127.0.0.1:3000"],
  allowedOrigins: ["http://127.0.0.1:3000"],
} as const;

function request(overrides: Readonly<Record<string, string>> = {}) {
  return new Request("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      cookie: `${AUTH_CSRF_COOKIE_DEV}=${token}`,
      "x-rentproof-csrf": token,
      ...overrides,
    },
  });
}

describe("self-hosted auth request guard", () => {
  it("enables only loopback HTTP development or HTTPS production", () => {
    expect(isSelfHostedAuthRouteEnabled(local)).toBe(true);
    expect(
      isSelfHostedAuthRouteEnabled({
        ...local,
        RENTPROOF_DEPLOYMENT_PROFILE: "production",
        RENTPROOF_PUBLIC_ORIGIN: "https://rentproof.example",
      }),
    ).toBe(true);
    for (const changed of [
      { RENTPROOF_AUTH_MODE: "synthetic" },
      { RENTPROOF_DEPLOYMENT_PROFILE: "lan_development" },
      { RENTPROOF_PUBLIC_ORIGIN: "http://192.168.1.8:3000" },
      { RENTPROOF_PUBLIC_ORIGIN: "https://127.0.0.1:3000" },
    ]) {
      expect(isSelfHostedAuthRouteEnabled({ ...local, ...changed })).toBe(false);
    }
  });

  it("accepts exact Host for reads and exact Origin plus double-submit CSRF for mutations", () => {
    expect(validateSelfHostedAuthRead(request(), local)).toBe(true);
    expect(validateSelfHostedAuthMutation(request(), local)).toBe(true);
  });

  it("returns stable typed read-diagnostic reasons without request values", () => {
    expect(diagnoseSelfHostedAuthRead(request(), local)).toEqual({ ok: true, reason: "OK" });
    expect(
      diagnoseSelfHostedAuthRead(request(), { ...local, RENTPROOF_AUTH_MODE: "synthetic" }),
    ).toEqual({ ok: false, reason: "AUTH_DISABLED" });
    expect(
      diagnoseSelfHostedAuthRead(new Request("http://127.0.0.1:3000/api/auth/session"), local),
    ).toEqual({ ok: false, reason: "HOST_MISSING" });
    expect(diagnoseSelfHostedAuthRead(request({ "x-forwarded-proto": "https" }), local)).toEqual({
      ok: false,
      reason: "NETWORK_FORWARDED_PROTO_MISMATCH",
    });
  });

  it.each([
    ["host", "evil.example"],
    ["origin", "http://evil.example"],
    ["content-type", "text/plain"],
    ["sec-fetch-site", "cross-site"],
    ["x-rentproof-csrf", "b".repeat(43)],
    ["x-forwarded-host", "evil.invalid:3000"],
    ["x-forwarded-proto", "https"],
    ["x-forwarded-port", "443"],
    ["x-forwarded-for", "127.0.0.1, 198.51.100.2"],
    ["forwarded", "host=127.0.0.1:3000"],
  ])("rejects unsafe %s", (name, value) => {
    expect(validateSelfHostedAuthMutation(request({ [name]: value }), local)).toBe(false);
  });

  it("accepts the exact single-value forwarding metadata synthesized by Next 16", () => {
    expect(
      validateSelfHostedAuthMutation(
        request({
          "x-forwarded-host": "127.0.0.1:3000",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "3000",
          "x-forwarded-for": "127.0.0.1",
        }),
        local,
      ),
    ).toBe(true);
  });

  it("rejects missing, invalid, or duplicate CSRF cookies", () => {
    expect(validateSelfHostedAuthMutation(request({ cookie: "unrelated=value" }), local)).toBe(
      false,
    );
    expect(
      validateSelfHostedAuthMutation(
        request({ cookie: `${AUTH_CSRF_COOKIE_DEV}=${token}; ${AUTH_CSRF_COOKIE_DEV}=${token}` }),
        local,
      ),
    ).toBe(false);
    expect(
      readUniqueCookie(`${AUTH_CSRF_COOKIE_DEV}=bad%20token`, AUTH_CSRF_COOKIE_DEV),
    ).toBeNull();
  });

  it("selects host-only Secure cookie names for production and development names for loopback", () => {
    expect(authCookieNames(local)).toMatchObject({
      secure: false,
      session: "rentproof_account_dev",
    });
    expect(authCookieNames({ ...local, RENTPROOF_DEPLOYMENT_PROFILE: "production" })).toMatchObject(
      { secure: true, session: "__Host-rentproof_account" },
    );
  });
});
