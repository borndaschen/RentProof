import { describe, expect, it } from "vitest";
import { detectSensitiveConversationContent } from "./sensitive-content";

describe("detectSensitiveConversationContent", () => {
  it("allows ordinary rental questions", () => {
    expect(detectSensitiveConversationContent("電費每度五元，要怎麼確認？")).toMatchObject({
      decision: "allow",
    });
    expect(detectSensitiveConversationContent("請問可以使用 QR code 嗎？")).toMatchObject({
      decision: "allow",
    });
  });

  it("warns for general PII without returning matched text", () => {
    const raw = "請寄到 tenant@example.com，電話是 0912-345-678";
    const result = detectSensitiveConversationContent(raw);

    expect(result).toEqual({
      decision: "warning_required",
      code: "PII_WARNING_REQUIRED",
      detectorVersion: "conversation-sensitive-content.v1",
      piiKinds: ["email", "phone"],
    });
    expect(JSON.stringify(result)).not.toContain("tenant@example.com");
    expect(JSON.stringify(result)).not.toContain("0912");
  });

  it("warns for Taiwan ID and a sufficiently complete address", () => {
    expect(detectSensitiveConversationContent("身分證 A123456789")).toMatchObject({
      decision: "warning_required",
      piiKinds: ["taiwan_national_id"],
    });
    expect(detectSensitiveConversationContent("地址是臺北市大安區和平東路12號")).toMatchObject({
      decision: "warning_required",
      piiKinds: ["full_address"],
    });
    expect(detectSensitiveConversationContent("物件在臺北市")).toMatchObject({
      decision: "allow",
    });
  });

  it.each([
    ["password", "密碼是 never-share-this"],
    ["one_time_code", "驗證碼：123456"],
    ["api_key", "api key = abcdefghijklmnopqrstuv"],
    ["authorization_token", "Authorization: Bearer abcdefghijklmnopqrstuv"],
    ["session_token", "session_token=abcdefghijklmnopqrstuv"],
    ["private_key", "-----BEGIN PRIVATE KEY-----\nabc"],
    ["financial_account", "銀行帳號：1234 5678 9012"],
    ["qr_payload", "QR碼：https://pay.example/abc123"],
    ["data_url", "data:image/png;base64,AAAA"],
  ] as const)("hard-blocks %s without returning its value", (kind, raw) => {
    const result = detectSensitiveConversationContent(raw);
    expect(result).toMatchObject({
      decision: "hard_block",
      code: "AUTH_SECRET_DETECTED",
      secretKinds: [kind],
    });
    expect(JSON.stringify(result)).not.toContain(raw);
  });

  it("lets a hard block take precedence over a PII warning", () => {
    expect(detectSensitiveConversationContent("tenant@example.com 的 OTP 是 123456")).toMatchObject(
      { decision: "hard_block", secretKinds: ["one_time_code"] },
    );
  });
});
