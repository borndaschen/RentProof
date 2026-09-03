import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NumericVerificationCodeService } from "./numeric-verification-code";

const key = new Uint8Array(32).fill(7);

describe("NumericVerificationCodeService", () => {
  it("issues exactly six decimal digits and a SHA-256 HMAC digest", () => {
    const service = new NumericVerificationCodeService(key);
    const result = service.issue();
    expect(result.rawToken).toMatch(/^\d{6}$/u);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(service.digest(result.rawToken)).toBe(result.digest);
  });

  it("accepts leading zeroes as part of the six-digit code", () => {
    expect(new NumericVerificationCodeService(key).digest("000042")).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("is deterministic and domain separated", () => {
    const service = new NumericVerificationCodeService(key);
    const digest = service.digest("123456");
    expect(digest).toBe(service.digest("123456"));
    const unseparated = createHmac("sha256", key).update("123456", "ascii").digest("hex");
    expect(digest).not.toBe(unseparated);
  });

  it.each(["", "12345", "1234567", "１２３４５６", "12 3456", "abc123"])(
    "returns null for invalid code %j",
    (code) => expect(new NumericVerificationCodeService(key).digest(code)).toBeNull(),
  );

  it("rejects a weak key", () => {
    expect(() => new NumericVerificationCodeService(new Uint8Array(31))).toThrow(
      "AUTH_VERIFICATION_KEY_TOO_SHORT",
    );
  });
});
