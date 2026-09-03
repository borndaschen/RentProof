import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({
    allowedHosts: ["127.0.0.1:3000"],
    allowedOrigins: ["http://127.0.0.1:3000"],
  }),
}));

import { readBoundedConfirmationJson, validateConfirmationRequest } from "./request-guard";

const baseHeaders = {
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  "content-type": "application/json; charset=utf-8",
};

function request(
  body: BodyInit = "{}",
  overrides: Record<string, string | undefined> = {},
): Request {
  const headers = new Headers(baseHeaders);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request("http://127.0.0.1:3000/api/cases/golden-v1/confirmations", {
    method: "POST",
    headers,
    body,
  });
}

describe("confirmation request guard", () => {
  it("accepts only exact Host, Origin, and JSON content type", () => {
    expect(validateConfirmationRequest(request())).toBe(true);
    expect(validateConfirmationRequest(request("{}", { host: "0.0.0.0:3000" }))).toBe(false);
    expect(validateConfirmationRequest(request("{}", { origin: "http://192.168.1.50:3000" }))).toBe(
      false,
    );
    expect(validateConfirmationRequest(request("{}", { "content-type": "text/plain" }))).toBe(
      false,
    );
  });

  it("allows only framework-matching forwarding metadata and never uses client IP for authority", () => {
    expect(validateConfirmationRequest(request("{}", { forwarded: "for=attacker" }))).toBe(false);
    expect(validateConfirmationRequest(request("{}", { "x-forwarded-for": "attacker" }))).toBe(
      true,
    );
    expect(
      validateConfirmationRequest(
        request("{}", { "x-forwarded-host": "127.0.0.1:3000", "x-forwarded-proto": "http" }),
      ),
    ).toBe(true);
    expect(
      validateConfirmationRequest(request("{}", { "x-forwarded-host": "attacker.example" })),
    ).toBe(false);
    expect(validateConfirmationRequest(request("{}", { "x-forwarded-proto": "https" }))).toBe(
      false,
    );
  });

  it("accepts exactly 1 KiB and rejects streamed or declared over-limit bodies", async () => {
    const prefix = '{"value":"';
    const suffix = '"}';
    const exact = `${prefix}${"x".repeat(1_024 - prefix.length - suffix.length)}${suffix}`;
    expect(new TextEncoder().encode(exact)).toHaveLength(1_024);
    await expect(readBoundedConfirmationJson(request(exact))).resolves.toMatchObject({
      value: expect.any(String),
    });

    await expect(readBoundedConfirmationJson(request(`${exact}x`))).rejects.toThrow(
      "CONFIRMATION_REQUEST_TOO_LARGE",
    );
    await expect(
      readBoundedConfirmationJson(request("{}", { "content-length": "1025" })),
    ).rejects.toThrow("CONFIRMATION_REQUEST_TOO_LARGE");
  });

  it("rejects invalid UTF-8, NUL, missing body, and invalid JSON", async () => {
    await expect(
      readBoundedConfirmationJson(request(new Uint8Array([0xc3, 0x28]))),
    ).rejects.toThrow();
    await expect(readBoundedConfirmationJson(request('{"value":"\0"}'))).rejects.toThrow(
      "CONFIRMATION_REQUEST_INVALID",
    );
    const noBody = new Request("http://127.0.0.1:3000/api/cases/golden-v1/confirmations", {
      method: "POST",
      headers: baseHeaders,
    });
    await expect(readBoundedConfirmationJson(noBody)).rejects.toThrow(
      "CONFIRMATION_REQUEST_INVALID",
    );
    await expect(readBoundedConfirmationJson(request("not-json"))).rejects.toThrow();
  });
});
