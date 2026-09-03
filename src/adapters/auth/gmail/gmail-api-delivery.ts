import { z } from "zod";
import type { PasswordResetDeliveryPort } from "@/application/auth";

const GmailConfigurationSchema = z
  .object({
    sender: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(254)
      .regex(/^[\x20-\x7E]+@gmail\.com$/u),
    clientId: z
      .string()
      .min(20)
      .max(300)
      .regex(/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/u),
    clientSecret: z
      .string()
      .min(8)
      .max(512)
      .regex(/^[\x21-\x7E]+$/u),
    refreshToken: z
      .string()
      .min(20)
      .max(2_048)
      .regex(/^[\x21-\x7E]+$/u),
    publicOrigin: z.url().refine((value) => value.startsWith("https://")),
  })
  .strict();

const AccessTokenResponseSchema = z.object({
  access_token: z.string().min(20).max(8_192),
  token_type: z.string().toLowerCase().pipe(z.literal("bearer")),
});

const GmailSendResponseSchema = z.object({ id: z.string().min(1).max(256) });

export type PersonalGmailConfiguration = z.infer<typeof GmailConfigurationSchema>;

export class GmailDeliveryError extends Error {
  override readonly name = "GmailDeliveryError";
}

export function parsePersonalGmailConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): PersonalGmailConfiguration {
  try {
    return GmailConfigurationSchema.parse({
      sender: environment["RENTPROOF_GMAIL_SENDER"],
      clientId: environment["RENTPROOF_GMAIL_CLIENT_ID"],
      clientSecret: environment["RENTPROOF_GMAIL_CLIENT_SECRET"],
      refreshToken: environment["RENTPROOF_GMAIL_REFRESH_TOKEN"],
      publicOrigin: environment["RENTPROOF_PUBLIC_ORIGIN"],
    });
  } catch {
    throw new GmailDeliveryError("GMAIL_CONFIGURATION_INVALID");
  }
}

export class PersonalGmailPasswordResetDelivery implements PasswordResetDeliveryPort {
  private readonly configuration: PersonalGmailConfiguration;
  private readonly request: typeof fetch;

  constructor(configuration: PersonalGmailConfiguration, request: typeof fetch = fetch) {
    this.configuration = configuration;
    this.request = request;
  }

  sendEmailVerification(
    input: Parameters<PasswordResetDeliveryPort["sendEmailVerification"]>[0],
  ): Promise<void> {
    return this.send({
      to: input.normalizedEmail,
      subject: "RentProof Email 驗證碼",
      purpose: "完成 Email 驗證",
      rawToken: input.rawToken,
    });
  }

  sendPasswordReset(
    input: Parameters<PasswordResetDeliveryPort["sendPasswordReset"]>[0],
  ): Promise<void> {
    return this.send({
      to: input.normalizedEmail,
      subject: "RentProof 密碼重設碼",
      purpose: "重設密碼",
      rawToken: input.rawToken,
    });
  }

  sendConnectivityTest(normalizedEmail: string): Promise<void> {
    return this.send({
      to: normalizedEmail,
      subject: "RentProof Gmail API 連線測試",
      purpose: "測試郵件通道",
      rawToken: "這不是驗證碼，不需要進行任何操作",
    });
  }

  private async send(input: {
    to: string;
    subject: string;
    purpose: string;
    rawToken: string;
  }): Promise<void> {
    const accessToken = await this.exchangeRefreshToken();
    const raw = buildGmailMessage({
      from: this.configuration.sender,
      to: input.to,
      subject: input.subject,
      body: [
        `請使用以下一次性代碼${input.purpose}：`,
        "",
        input.rawToken,
        "",
        "代碼將於 15 分鐘後失效，且只能使用一次。若你沒有提出此要求，請忽略這封信。",
        `RentProof：${this.configuration.publicOrigin}`,
      ].join("\r\n"),
    });
    const response = await this.safeFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ raw }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new GmailDeliveryError("GMAIL_SEND_FAILED");
    const result = GmailSendResponseSchema.safeParse(await readBoundedJson(response, 8_192));
    if (!result.success) throw new GmailDeliveryError("GMAIL_RESPONSE_INVALID");
  }

  private async exchangeRefreshToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.configuration.clientId,
      client_secret: this.configuration.clientSecret,
      refresh_token: this.configuration.refreshToken,
      grant_type: "refresh_token",
    });
    const response = await this.safeFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new GmailDeliveryError("GMAIL_TOKEN_EXCHANGE_FAILED");
    const result = AccessTokenResponseSchema.safeParse(await readBoundedJson(response, 16_384));
    if (!result.success) throw new GmailDeliveryError("GMAIL_TOKEN_RESPONSE_INVALID");
    return result.data.access_token;
  }

  private async safeFetch(input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.request(input, init);
    } catch {
      throw new GmailDeliveryError("GMAIL_NETWORK_FAILED");
    }
  }
}

function buildGmailMessage(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const encodedSubject = Buffer.from(input.subject, "utf8").toString("base64");
  const encodedBody = Buffer.from(input.body, "utf8").toString("base64");
  const mime = [
    `From: RentProof <${input.from}>`,
    `To: ${input.to}`,
    `Subject: =?UTF-8?B?${encodedSubject}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
    "",
    encodedBody,
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) {
    throw new GmailDeliveryError("GMAIL_RESPONSE_TOO_LARGE");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new GmailDeliveryError("GMAIL_RESPONSE_TOO_LARGE");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new GmailDeliveryError("GMAIL_RESPONSE_INVALID");
  }
}
