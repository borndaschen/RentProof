import { describe, expect, it } from "vitest";
import {
  isAuthProxyExcludedPath,
  sanitizedDirectRequestHeaders,
  validateGlobalNetworkBoundary,
} from "./request-boundary";

const environment = {
  allowedHosts: ["127.0.0.1:3000", "localhost:3000"],
  RENTPROOF_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
};

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({ host: "127.0.0.1:3000", ...overrides });
}

describe("validateGlobalNetworkBoundary", () => {
  it("accepts allowlisted Host for safe GET-style requests without Origin", () => {
    expect(validateGlobalNetworkBoundary(headers(), environment)).toEqual({ ok: true });
    expect(validateGlobalNetworkBoundary(headers({ host: "localhost:3000" }), environment)).toEqual(
      { ok: true },
    );
  });

  it.each([
    ["missing", new Headers()],
    ["unlisted", headers({ host: "evil.invalid:3000" })],
    ["multiple", headers({ host: "127.0.0.1:3000,evil.invalid:3000" })],
    ["scheme", headers({ host: "http://127.0.0.1:3000" })],
    ["path", headers({ host: "127.0.0.1:3000/path" })],
    ["userinfo", headers({ host: "user@127.0.0.1:3000" })],
  ])("rejects %s Host", (_label, requestHeaders) => {
    expect(validateGlobalNetworkBoundary(requestHeaders, environment)).toEqual({
      ok: false,
      reason: "HOST_INVALID",
    });
  });

  it("never treats a wildcard allowlist as authorization", () => {
    expect(
      validateGlobalNetworkBoundary(headers(), { ...environment, allowedHosts: ["*"] }),
    ).toEqual({ ok: false, reason: "HOST_INVALID" });
  });

  it("rejects forwarded host, protocol, and port spoofing", () => {
    expect(
      validateGlobalNetworkBoundary(
        headers({ "x-forwarded-host": "evil.invalid:3000" }),
        environment,
      ),
    ).toMatchObject({ ok: false, reason: "FORWARDED_HOST_MISMATCH" });
    expect(
      validateGlobalNetworkBoundary(headers({ "x-forwarded-proto": "https" }), environment),
    ).toMatchObject({ ok: false, reason: "FORWARDED_PROTO_MISMATCH" });
    expect(
      validateGlobalNetworkBoundary(headers({ "x-forwarded-port": "80" }), environment),
    ).toMatchObject({ ok: false, reason: "FORWARDED_PORT_MISMATCH" });
  });

  it("accepts Next self-hosted matching forwarding metadata but rejects chains", () => {
    expect(
      validateGlobalNetworkBoundary(
        headers({
          "x-forwarded-host": "127.0.0.1:3000",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "3000",
          "x-forwarded-for": "127.0.0.1",
        }),
        environment,
      ),
    ).toEqual({ ok: true });
    expect(
      validateGlobalNetworkBoundary(
        headers({ "x-forwarded-for": "198.51.100.2, 127.0.0.1" }),
        environment,
      ),
    ).toMatchObject({ ok: false, reason: "FORWARDED_FOR_INVALID" });
  });

  it.each(["forwarded", "x-forwarded-server", "x-original-host", "x-host"])(
    "rejects untrusted %s metadata",
    (name) => {
      expect(
        validateGlobalNetworkBoundary(headers({ [name]: "spoofed" }), environment),
      ).toMatchObject({
        ok: false,
        reason: "FORWARDED_HEADER_FORBIDDEN",
      });
    },
  );
});

describe("isAuthProxyExcludedPath", () => {
  it("identifies static assets while retaining the global network boundary", () => {
    expect(isAuthProxyExcludedPath("/_next/static/chunks/app.js")).toBe(true);
    expect(isAuthProxyExcludedPath("/_next/image")).toBe(true);
    expect(isAuthProxyExcludedPath("/favicon.ico")).toBe(true);
    expect(isAuthProxyExcludedPath("/api/runtime-status")).toBe(false);
  });
});

describe("sanitizedDirectRequestHeaders", () => {
  it("removes all forwarding metadata before application code", () => {
    const result = sanitizedDirectRequestHeaders(
      headers({
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-proto": "http",
        "x-forwarded-port": "3000",
        "x-forwarded-for": "198.51.100.2",
      }),
    );
    expect(result.get("host")).toBe("127.0.0.1:3000");
    expect([...result.keys()].some((name) => name.startsWith("x-forwarded"))).toBe(false);
  });
});
