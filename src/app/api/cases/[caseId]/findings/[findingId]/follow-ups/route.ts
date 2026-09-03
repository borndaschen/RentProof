import { z } from "zod";
import { getServerEnvironment } from "@/server/env";
import { applySealedWallFollowUp } from "@/server/follow-ups";

export const runtime = "nodejs";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
const BodySchema = z
  .object({
    receiptId: OpaqueIdSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string; findingId: string }> },
): Promise<Response> {
  const env = getServerEnvironment();
  const { caseId, findingId } = await context.params;
  if (caseId !== "golden-v1" || findingId !== "finding_wall_follow_up_00001") {
    return new Response(null, { status: 404 });
  }
  const guard = validateRequest(request, env.allowedHosts, env.allowedOrigins);
  if (!guard.ok) return error(guard.code, guard.status);
  if (env.RENTPROOF_ALLOW_REAL_DATA !== "false") return error("FOLLOW_UP_SYNTHETIC_ONLY", 503);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey === null || !OpaqueIdSchema.safeParse(idempotencyKey).success) {
    return error("IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("FOLLOW_UP_REQUEST_INVALID", 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return error("FOLLOW_UP_REQUEST_INVALID", 400);
  const result = await applySealedWallFollowUp({
    caseId,
    findingId,
    receiptId: parsed.data.receiptId,
    expectedRevision: parsed.data.expectedRevision,
    idempotencyKey,
  });
  return result.ok
    ? Response.json(result.view, { status: result.status, headers: noStoreHeaders() })
    : error(result.code, result.status);
}

function validateRequest(
  request: Request,
  allowedHosts: readonly string[],
  allowedOrigins: readonly string[],
): { ok: true } | { ok: false; code: string; status: number } {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (host === null || !allowedHosts.includes(host)) {
    return { ok: false, code: "REQUEST_HOST_FORBIDDEN", status: 403 };
  }
  if (origin === null || !allowedOrigins.includes(origin)) {
    return { ok: false, code: "REQUEST_ORIGIN_FORBIDDEN", status: 403 };
  }
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return { ok: false, code: "FOLLOW_UP_CONTENT_TYPE_UNSUPPORTED", status: 415 };
  }
  if (request.headers.get("x-rentproof-csrf") !== "rentproof-synthetic-follow-up-v1") {
    return { ok: false, code: "FOLLOW_UP_CSRF_REQUIRED", status: 403 };
  }
  if (request.headers.has("forwarded") || request.headers.has("x-forwarded-host")) {
    return { ok: false, code: "FORWARDED_HEADER_FORBIDDEN", status: 403 };
  }
  return { ok: true };
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}

function error(code: string, status: number): Response {
  return Response.json(
    { error: { code, retryable: status === 503 } },
    { status, headers: noStoreHeaders() },
  );
}
