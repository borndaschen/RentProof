import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({
    allowedHosts: ["127.0.0.1:3000"],
    allowedOrigins: ["http://127.0.0.1:3000"],
  }),
}));

import { validateConversationRequest } from "./request-guard";

const baseHeaders = {
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  "content-type": "text/plain; charset=utf-8",
  "idempotency-key": "12345678-1234-4234-8234-123456789012",
};

function request(overrides: Record<string, string | undefined> = {}): Request {
  const headers = new Headers(baseHeaders);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request("http://127.0.0.1:3000/api/cases/golden-v1/conversation/turns", {
    method: "POST",
    headers,
  });
}

describe("validateConversationRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts only the exact configured host and origin", () => {
    expect(validateConversationRequest(request())).toEqual({ ok: true });
    expect(validateConversationRequest(request({ host: "0.0.0.0:3000" }))).toMatchObject({
      ok: false,
      code: "REQUEST_HOST_FORBIDDEN",
    });
    expect(
      validateConversationRequest(request({ origin: "http://192.168.1.20:3000" })),
    ).toMatchObject({ ok: false, code: "REQUEST_ORIGIN_FORBIDDEN" });
  });

  it("rejects untrusted forwarding metadata", () => {
    expect(validateConversationRequest(request({ forwarded: "for=192.168.1.2" }))).toMatchObject({
      ok: false,
      code: "FORWARDED_HEADER_FORBIDDEN",
    });
    expect(
      validateConversationRequest(request({ "x-forwarded-host": "attacker.example" })),
    ).toMatchObject({ ok: false, code: "FORWARDED_HEADER_FORBIDDEN" });
    expect(validateConversationRequest(request({ "x-forwarded-proto": "https" }))).toMatchObject({
      ok: false,
      code: "FORWARDED_HEADER_FORBIDDEN",
    });
  });

  it("requires text/plain and an idempotency key", () => {
    expect(
      validateConversationRequest(request({ "content-type": "application/json" })),
    ).toMatchObject({ ok: false, status: 415 });
    expect(validateConversationRequest(request({ "idempotency-key": undefined }))).toMatchObject({
      ok: false,
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  });
});
