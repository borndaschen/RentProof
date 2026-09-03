import { describe, expect, it } from "vitest";
import { HmacOpaqueTokenService, parseAccountTokenKey } from "./opaque-token";

describe("HmacOpaqueTokenService", () => {
  it("issues random opaque values while exposing only a keyed digest to persistence", () => {
    const service = new HmacOpaqueTokenService(new Uint8Array(32).fill(7));
    const first = service.issue();
    const second = service.issue();
    expect(first.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.digest).not.toBe(second.digest);
    expect(service.digest(first.rawToken)).toBe(first.digest);
    expect(service.digest(`${first.rawToken}x`)).toBeNull();
  });

  it("requires at least 256 bits of key material", () => {
    expect(() => new HmacOpaqueTokenService(new Uint8Array(31))).toThrow(
      "AUTH_TOKEN_KEY_TOO_SHORT",
    );
    const encoded = Buffer.alloc(32, 3).toString("base64url");
    expect(parseAccountTokenKey(encoded)).toHaveLength(32);
    expect(() => parseAccountTokenKey("short")).toThrow("AUTH_TOKEN_KEY_INVALID");
  });
});
