import { createHash } from "node:crypto";
import { z } from "zod";
import { InMemoryConversationRateLimiter } from "@/application/conversation/security";
import { loadFixtureAnalysisSnapshot } from "@/server/demo/fixture-analysis";
import { getServerEnvironment } from "@/server/env";
import type { PrivateUploadRecord } from "@/server/uploads/contracts";
import { getSyntheticUploadService } from "@/server/uploads/runtime";
import { registerFollowUpBaseSnapshot } from "@/server/follow-ups";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    receiptIds: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u))
      .min(3)
      .max(4),
  })
  .strict()
  .superRefine((body, context) => {
    if (new Set(body.receiptIds).size !== body.receiptIds.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_RECEIPT" });
    }
  });
const idempotencyPattern = /^[A-Za-z0-9_-]{20,128}$/u;
const completed = new Map<string, { payloadHash: string; response: unknown }>();
const limiter = new InMemoryConversationRateLimiter();
let running = false;

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const env = getServerEnvironment();
  const { caseId } = await context.params;
  if (caseId !== "golden-v1" || caseId !== env.RENTPROOF_DEMO_CASE_VERSION) {
    return new Response(null, { status: 404 });
  }
  const guard = validateRequest(request, env.allowedHosts, env.allowedOrigins);
  if (!guard.ok) return error(guard.code, guard.status);
  if (env.RENTPROOF_ALLOW_REAL_DATA !== "false") return error("ANALYSIS_SYNTHETIC_ONLY", 503);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyPattern.test(idempotencyKey)) {
    return error("IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  let raw: string;
  try {
    raw = await readBoundedText(request, 4_096);
  } catch {
    return error("ANALYSIS_REQUEST_INVALID", 400);
  }
  let unknownBody: unknown;
  try {
    if (raw.includes("\0")) throw new Error("nul");
    unknownBody = JSON.parse(raw) as unknown;
  } catch {
    return error("ANALYSIS_REQUEST_INVALID", 400);
  }
  const parsed = BodySchema.safeParse(unknownBody);
  if (!parsed.success) return error("ANALYSIS_REQUEST_INVALID", 400);
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(parsed.data), "utf8")
    .digest("hex");
  const prior = completed.get(idempotencyKey);
  if (prior) {
    return prior.payloadHash === payloadHash
      ? Response.json(prior.response, { headers: noStoreHeaders() })
      : error("IDEMPOTENCY_KEY_CONFLICT", 409);
  }
  const rate = limiter.consume({
    actorRef: "fixture_analysis_actor_01",
    sourceIp: "direct-fixture-analysis",
  });
  if (!rate.ok) return error("ANALYSIS_RATE_LIMITED", 429, rate.retryAfterSeconds);
  if (running) return error("ANALYSIS_RUN_IN_PROGRESS", 409);
  running = true;
  try {
    const receipts = parsed.data.receiptIds.map((id) =>
      getSyntheticUploadService().receiptStore.getPrivate(id),
    );
    if (receipts.some((receipt) => receipt === null)) {
      return error("ANALYSIS_RECEIPT_NOT_FOUND", 404);
    }
    const kinds = new Set(receipts.map((receipt) => receipt?.receipt.kind));
    const requiredKinds = ["listing", "viewing", "contract"] as const;
    if (!requiredKinds.every((kind) => kinds.has(kind))) {
      return error("ANALYSIS_REQUIRED_ARTIFACT_MISSING", 409);
    }
    let response: unknown;
    if (env.RENTPROOF_LLM_MODE === "fixture") {
      response = await loadFixtureAnalysisSnapshot();
    } else {
      const live = await runLiveAnalysis(
        caseId,
        receipts.filter((receipt) => receipt !== null),
        env.RENTPROOF_RULE_PROFILE,
      );
      if (!live.ok) return error(live.code, live.status, live.status === 429 ? 5 : undefined);
      response = live.response;
    }
    registerFollowUpBaseSnapshot(response);
    completed.set(idempotencyKey, { payloadHash, response });
    return Response.json(response, { status: 201, headers: noStoreHeaders() });
  } catch {
    return error(
      env.RENTPROOF_LLM_MODE === "fixture"
        ? "FIXTURE_ANALYSIS_UNAVAILABLE"
        : "ANALYSIS_PROVIDER_UNAVAILABLE",
      503,
    );
  } finally {
    running = false;
  }
}

async function runLiveAnalysis(
  caseId: "golden-v1",
  receipts: readonly PrivateUploadRecord[],
  ruleProfile: "p0" | "p1",
): Promise<{ ok: true; response: unknown } | { ok: false; code: string; status: number }> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return { ok: false, code: "ANALYSIS_PROVIDER_AUTH_FAILED", status: 503 };
  const { executeLiveSyntheticAnalysis } = await import("@/server/analysis/live/runtime");
  const result = await executeLiveSyntheticAnalysis({ apiKey, caseId, receipts, ruleProfile });
  if (result.ok) return { ok: true, response: result.snapshot };
  return { ok: false, code: result.code, status: liveFailureStatus(result.code) };
}

function liveFailureStatus(code: string): number {
  if (code === "ANALYSIS_PROVIDER_RATE_LIMITED" || code === "ANALYSIS_BUDGET_EXCEEDED") {
    return 429;
  }
  if (code === "ANALYSIS_PROVIDER_REFUSED" || code === "ANALYSIS_LOCATOR_INVALID") return 422;
  return 503;
}

function validateRequest(
  request: Request,
  allowedHosts: readonly string[],
  allowedOrigins: readonly string[],
): { ok: true } | { ok: false; code: string; status: number } {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !allowedHosts.includes(host))
    return { ok: false, code: "REQUEST_HOST_FORBIDDEN", status: 403 };
  if (!origin || !allowedOrigins.includes(origin))
    return { ok: false, code: "REQUEST_ORIGIN_FORBIDDEN", status: 403 };
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return { ok: false, code: "ANALYSIS_CONTENT_TYPE_UNSUPPORTED", status: 415 };
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (
    request.headers.has("forwarded") ||
    (forwardedHost !== null && forwardedHost !== host) ||
    (forwardedProto !== null && forwardedProto !== new URL(origin).protocol.slice(0, -1))
  ) {
    return { ok: false, code: "FORWARDED_HEADER_FORBIDDEN", status: 403 };
  }
  if (request.headers.get("x-rentproof-csrf") !== "rentproof-synthetic-analysis-v1") {
    return { ok: false, code: "ANALYSIS_CSRF_REQUIRED", status: 403 };
  }
  return { ok: true };
}

async function readBoundedText(request: Request, maximumBytes: number): Promise<string> {
  if (!request.body) throw new Error("missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}

function error(code: string, status: number, retryAfterSeconds?: number): Response {
  return Response.json(
    { error: { code, retryable: status === 429 || status === 503 } },
    {
      status,
      headers: {
        ...noStoreHeaders(),
        ...(retryAfterSeconds === undefined ? {} : { "Retry-After": String(retryAfterSeconds) }),
      },
    },
  );
}
