import "server-only";
import { getServerEnvironment } from "@/server/env";

export type RequestGuardResult =
  { ok: true } | { ok: false; status: 400 | 403 | 415; code: string };

export function validateConversationRequest(request: Request): RequestGuardResult {
  const env = getServerEnvironment();
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();

  if (!host || !env.allowedHosts.includes(host)) {
    return { ok: false, status: 403, code: "REQUEST_HOST_FORBIDDEN" };
  }
  if (!origin || !env.allowedOrigins.includes(origin)) {
    return { ok: false, status: 403, code: "REQUEST_ORIGIN_FORBIDDEN" };
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (
    request.headers.has("forwarded") ||
    (forwardedHost !== null && forwardedHost !== host) ||
    (forwardedProto !== null && forwardedProto !== new URL(origin).protocol.slice(0, -1))
  ) {
    return { ok: false, status: 403, code: "FORWARDED_HEADER_FORBIDDEN" };
  }
  if (contentType !== "text/plain") {
    return { ok: false, status: 415, code: "CONVERSATION_CONTENT_TYPE_UNSUPPORTED" };
  }
  if (!request.headers.get("idempotency-key")) {
    return { ok: false, status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" };
  }
  return { ok: true };
}
