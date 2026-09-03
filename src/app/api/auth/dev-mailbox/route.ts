import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
import { privateHeaders } from "@/server/auth/http";
import {
  authCookieNames,
  isSelfHostedAuthRouteEnabled,
  readUniqueCookie,
  validateSelfHostedAuthFormMutation,
} from "@/server/auth/request-guard";
import { selfHostedAuthRateLimiter } from "@/server/auth/rate-limit";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

const MailboxBodySchema = z
  .object({
    csrf: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    email: z.string().max(254),
    kind: z.enum(["verification", "password_reset"]),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  if (
    !isSelfHostedAuthRouteEnabled(environment) ||
    !["local_development", "lan_secure_demo"].includes(environment.RENTPROOF_DEPLOYMENT_PROFILE)
  ) {
    return new Response(null, { status: 404, headers: privateHeaders() });
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > 1_024)) {
    return new Response(null, { status: 400, headers: privateHeaders() });
  }
  let body: z.infer<typeof MailboxBodySchema>;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 1_024 || text.includes("\0")) throw new Error();
    const parameters = new URLSearchParams(text);
    for (const key of ["csrf", "email", "kind"]) {
      if (parameters.getAll(key).length !== 1) throw new Error();
    }
    const entries = Object.fromEntries(parameters);
    body = MailboxBodySchema.parse(entries);
  } catch {
    return new Response(null, { status: 400, headers: privateHeaders() });
  }
  if (!validateSelfHostedAuthFormMutation(request, environment, body.csrf)) {
    return new Response(null, { status: 404, headers: privateHeaders() });
  }
  const limited = selfHostedAuthRateLimiter.take(
    `dev-mailbox:${request.headers.get("host") ?? "unknown"}`,
  );
  if (!limited.allowed) {
    return new Response(null, {
      status: 429,
      headers: { ...privateHeaders(), "Retry-After": String(limited.retryAfterSeconds ?? 1) },
    });
  }
  try {
    const runtime = await getSelfHostedAuthRuntime();
    const rawContext = readUniqueCookie(
      request.headers.get("cookie"),
      authCookieNames(environment).preauth,
    );
    const deliveryContextDigest = rawContext ? runtime.digestPreAuthContext(rawContext) : null;
    if (!deliveryContextDigest) return htmlResponse(null);
    const code =
      body.kind === "verification"
        ? runtime.outbox.consumeLatestVerificationToken(body.email, deliveryContextDigest)
        : runtime.outbox.consumeLatestResetToken(body.email, deliveryContextDigest);
    return htmlResponse(code);
  } catch {
    return htmlResponse(null);
  }
}

function htmlResponse(code: string | null): Response {
  // A same-shape decoy prevents the verification center from becoming an account oracle.
  const value = code ?? randomBytes(32).toString("base64url");
  const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>RentProof 帳戶驗證</title><body><main><h1>帳戶驗證中心</h1><p>一次性驗證碼：</p><code>${value}</code><p>顯示後已移除；請勿重新整理或分享。</p><a href="/auth">返回登入／註冊</a></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      ...privateHeaders(),
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
