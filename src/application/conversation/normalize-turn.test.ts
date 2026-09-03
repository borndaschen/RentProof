import { describe, expect, it } from "vitest";
import { normalizeConversationTurn } from "./normalize-turn";

const encoder = new TextEncoder();

describe("normalizeConversationTurn", () => {
  it("enforces the code-point cap even when the raw byte cap is not exceeded", () => {
    const bytes = new Uint8Array(8_192).fill(0x61);
    const result = normalizeConversationTurn(bytes);
    expect(result).toEqual({ ok: false, code: "CONVERSATION_TURN_TOO_LARGE" });
  });

  it("rejects 8193 bytes before decoding", () => {
    const result = normalizeConversationTurn(new Uint8Array(8_193).fill(0x61));
    expect(result).toEqual({ ok: false, code: "CONVERSATION_TURN_TOO_LARGE" });
  });

  it("normalizes NFD to NFC and counts an emoji as one code point", () => {
    const result = normalizeConversationTurn(encoder.encode(`e\u0301🙂`));
    expect(result).toEqual({ ok: true, value: "é🙂" });
  });

  it("rejects invalid UTF-8 and NUL", () => {
    expect(normalizeConversationTurn(new Uint8Array([0xc3, 0x28]))).toEqual({
      ok: false,
      code: "CONVERSATION_TURN_INVALID_UTF8",
    });
    expect(normalizeConversationTurn(encoder.encode("a\0b"))).toEqual({
      ok: false,
      code: "CONVERSATION_TURN_NUL_DISALLOWED",
    });
  });

  it("accepts 2000 code points and rejects 2001", () => {
    expect(normalizeConversationTurn(encoder.encode("界".repeat(2_000))).ok).toBe(true);
    expect(normalizeConversationTurn(encoder.encode("界".repeat(2_001)))).toEqual({
      ok: false,
      code: "CONVERSATION_TURN_TOO_LARGE",
    });
  });
});
