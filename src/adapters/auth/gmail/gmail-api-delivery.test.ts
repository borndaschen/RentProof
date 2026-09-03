import { describe, expect, it, vi } from "vitest";
import {
  GmailDeliveryError,
  PersonalGmailPasswordResetDelivery,
  parsePersonalGmailConfiguration,
} from "./gmail-api-delivery";

const configuration = {
  sender: "rentproof.demo@gmail.com",
  clientId: `client-id-for-rentproof.apps.googleusercontent.com`,
  clientSecret: "client-secret",
  refreshToken: "refresh-token-with-enough-entropy",
  publicOrigin: "https://rentproof.example",
} as const;

describe("personal Gmail transactional delivery", () => {
  it("exchanges a refresh token and sends a bounded MIME message", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "a".repeat(32), token_type: "Bearer", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(Response.json({ id: "gmail-message-id" }));
    const delivery = new PersonalGmailPasswordResetDelivery(configuration, request);

    await delivery.sendEmailVerification({
      normalizedEmail: "user@example.com",
      rawToken: "v".repeat(43),
      deliveryContextDigest: "d".repeat(64),
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toBe("https://oauth2.googleapis.com/token");
    const tokenBody = request.mock.calls[0]?.[1]?.body;
    expect(tokenBody).toBeInstanceOf(URLSearchParams);
    expect(String(tokenBody)).toContain("grant_type=refresh_token");
    const send = request.mock.calls[1];
    expect(send?.[0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(send?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${"a".repeat(32)}` });
    const payload = JSON.parse(String(send?.[1]?.body)) as { raw: string };
    const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
    expect(mime).toContain("To: user@example.com");
    expect(mime).not.toContain(configuration.clientSecret);
    expect(mime).not.toContain(configuration.refreshToken);
  });

  it("sends a non-actionable connectivity message without creating an auth code", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "a".repeat(32), token_type: "Bearer" }))
      .mockResolvedValueOnce(Response.json({ id: "gmail-message-id" }));
    await new PersonalGmailPasswordResetDelivery(configuration, request).sendConnectivityTest(
      "operator@example.com",
    );
    const payload = JSON.parse(String(request.mock.calls[1]?.[1]?.body)) as { raw: string };
    const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
    const encodedBody = mime.split("\r\n\r\n").at(1) ?? "";
    expect(Buffer.from(encodedBody, "base64").toString("utf8")).toContain("這不是驗證碼");
  });

  it.each([
    ["token rejection", [new Response(null, { status: 401 })]],
    [
      "send rejection",
      [
        Response.json({ access_token: "a".repeat(32), token_type: "Bearer" }),
        new Response(null, { status: 403 }),
      ],
    ],
  ])("fails closed for %s", async (_label, responses) => {
    const request = vi.fn<typeof fetch>();
    for (const response of responses) request.mockResolvedValueOnce(response);
    const delivery = new PersonalGmailPasswordResetDelivery(configuration, request);
    await expect(
      delivery.sendPasswordReset({
        normalizedEmail: "user@example.com",
        rawToken: "r".repeat(43),
        deliveryContextDigest: "d".repeat(64),
      }),
    ).rejects.toBeInstanceOf(GmailDeliveryError);
  });

  it("rejects non-personal senders and incomplete OAuth credentials", () => {
    expect(() =>
      parsePersonalGmailConfiguration({
        RENTPROOF_GMAIL_SENDER: "sender@example.com",
        RENTPROOF_GMAIL_CLIENT_ID: configuration.clientId,
        RENTPROOF_GMAIL_CLIENT_SECRET: configuration.clientSecret,
        RENTPROOF_GMAIL_REFRESH_TOKEN: configuration.refreshToken,
        RENTPROOF_PUBLIC_ORIGIN: configuration.publicOrigin,
      }),
    ).toThrow("GMAIL_CONFIGURATION_INVALID");
    expect(() => parsePersonalGmailConfiguration({})).toThrow("GMAIL_CONFIGURATION_INVALID");
  });

  it("rejects malformed and oversized provider responses without exposing them", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "a".repeat(20_000), token_type: "Bearer" })),
      );
    const delivery = new PersonalGmailPasswordResetDelivery(configuration, request);
    const input = {
      normalizedEmail: "user@example.com",
      rawToken: "r".repeat(43),
      deliveryContextDigest: "d".repeat(64),
    };
    await expect(delivery.sendPasswordReset(input)).rejects.toBeInstanceOf(GmailDeliveryError);
    await expect(delivery.sendPasswordReset(input)).rejects.toBeInstanceOf(GmailDeliveryError);
  });

  it("maps network failure and declared oversized responses to stable errors", async () => {
    const network = new PersonalGmailPasswordResetDelivery(
      configuration,
      vi.fn<typeof fetch>().mockRejectedValue(new Error("private network detail")),
    );
    const input = {
      normalizedEmail: "user@example.com",
      rawToken: "r".repeat(43),
      deliveryContextDigest: "d".repeat(64),
    };
    await expect(network.sendPasswordReset(input)).rejects.toThrow("GMAIL_NETWORK_FAILED");

    const oversized = new PersonalGmailPasswordResetDelivery(
      configuration,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("{}", { headers: { "Content-Length": "20000" } })),
    );
    await expect(oversized.sendPasswordReset(input)).rejects.toThrow("GMAIL_RESPONSE_TOO_LARGE");
  });
});
