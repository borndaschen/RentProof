import { createHash } from "node:crypto";
import { normalizeConversationTurn } from "@/application/conversation/normalize-turn";
import { InMemoryConversationIdempotencyStore } from "@/application/conversation/idempotency";
import {
  detectSensitiveConversationContent,
  InMemoryConversationRateLimiter,
  InMemoryPiiAcknowledgementStore,
} from "@/application/conversation/security";
import { CONVERSATION_LIMITS, OpaqueIdSchema } from "@/domain/conversation";
import {
  createFixtureAssistantTurn,
  toConversationError,
  toPiiWarning,
} from "@/server/conversation/fixture-responder";
import { validateConversationRequest } from "@/server/conversation/request-guard";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

const idempotencyStore = new InMemoryConversationIdempotencyStore();
const completedResponses = new Map<string, { response: unknown; expiresAtMs: number }>();
const rateLimiter = new InMemoryConversationRateLimiter();
const piiAcknowledgements = new InMemoryPiiAcknowledgementStore();
const devActorRef = "dev_actor_fixture_000001";
const demoCaseRef = "demo_case_golden_v1_01";

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CONVERSATION_LIMITS.rawTurnBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const guard = validateConversationRequest(request);
  if (!guard.ok) return toConversationError(guard.code, guard.status);

  const { caseId } = await context.params;
  const env = getServerEnvironment();
  if (caseId !== env.RENTPROOF_DEMO_CASE_VERSION) {
    return toConversationError("CASE_NOT_FOUND", 404);
  }

  const rate = rateLimiter.consume({
    actorRef: devActorRef,
    sourceIp: getSourceIp(),
  });
  if (!rate.ok) {
    return Response.json(
      {
        error: {
          code: rate.code,
          message: "訊息送出太頻繁，請稍後再試。",
          retryable: true,
        },
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(rate.retryAfterSeconds),
        },
      },
    );
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await readBoundedBody(request);
  } catch {
    return toConversationError("CONVERSATION_ENCODING_INVALID", 400);
  }
  if (!bytes) return toConversationError("CONVERSATION_TURN_TOO_LARGE", 413);
  const normalized = normalizeConversationTurn(bytes);
  if (!normalized.ok)
    return toConversationError(
      normalized.code,
      normalized.code === "CONVERSATION_TURN_TOO_LARGE" ? 413 : 400,
    );

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!OpaqueIdSchema.safeParse(idempotencyKey).success) {
    return toConversationError("IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  const payloadHash = createHash("sha256").update(normalized.value, "utf8").digest("hex");
  const sensitive = detectSensitiveConversationContent(normalized.value);
  if (sensitive.decision === "hard_block") {
    return toConversationError("AUTH_SECRET_DETECTED", 422);
  }
  if (sensitive.decision === "warning_required") {
    const acknowledgementId = request.headers.get("pii-acknowledgement");
    if (!acknowledgementId) {
      const acknowledgement = piiAcknowledgements.issue({
        actorRef: devActorRef,
        caseId: demoCaseRef,
        caseRevision: 1,
        payloadHash,
        detectorVersion: sensitive.detectorVersion,
      });
      return toPiiWarning({ ...acknowledgement, piiKinds: sensitive.piiKinds });
    }
    const consumed = piiAcknowledgements.consume({
      acknowledgementId,
      actorRef: devActorRef,
      caseId: demoCaseRef,
      expectedCaseRevision: 1,
      payloadHash,
    });
    if (!consumed.ok) return toConversationError(consumed.code, 409);
  }

  pruneCompletedResponses();
  const operation = idempotencyStore.begin({
    idempotencyKey,
    actorRef: devActorRef,
    caseId: demoCaseRef,
    normalizedPayloadHash: payloadHash,
  });
  if (operation.kind === "conflict") return toConversationError(operation.code, 409);
  if (operation.kind === "case_busy" || operation.kind === "pending_reuse") {
    return toConversationError("CONVERSATION_TURN_IN_PROGRESS", 409);
  }
  if (operation.kind === "unavailable") {
    return toConversationError("CONVERSATION_RATE_LIMITER_UNAVAILABLE", 503);
  }
  if (operation.kind === "result_reuse") {
    const completed = completedResponses.get(operation.resultRef);
    if (!completed) return toConversationError("CONVERSATION_PROVIDER_UNAVAILABLE", 503);
    return Response.json(completed.response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  try {
    let response: unknown;
    if (env.RENTPROOF_LLM_MODE === "fixture") {
      response = createFixtureAssistantTurn(normalized.value);
    } else {
      const live = await executeLiveTurn(normalized.value);
      if (!live.ok) {
        idempotencyStore.release({
          leaseId: operation.leaseId,
          actorRef: devActorRef,
          caseId: demoCaseRef,
          idempotencyKey,
        });
        return toConversationError(
          live.code,
          live.code === "CONVERSATION_PROVIDER_RATE_LIMITED" ? 429 : 503,
        );
      }
      response = live.turn;
    }
    const resultRef = `result_${operation.operationId}`;
    completedResponses.set(resultRef, { response, expiresAtMs: Date.now() + 24 * 60 * 60 * 1_000 });
    const completed = idempotencyStore.complete({
      leaseId: operation.leaseId,
      actorRef: devActorRef,
      caseId: demoCaseRef,
      idempotencyKey,
      resultRef,
    });
    if (!completed.ok) {
      completedResponses.delete(resultRef);
      return toConversationError("CONVERSATION_PROVIDER_UNAVAILABLE", 503);
    }
    return Response.json(response, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    idempotencyStore.release({
      leaseId: operation.leaseId,
      actorRef: devActorRef,
      caseId: demoCaseRef,
      idempotencyKey,
    });
    return toConversationError("CONVERSATION_PROVIDER_UNAVAILABLE", 503);
  }
}

async function executeLiveTurn(normalizedTurn: string) {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("MODEL_CONFIGURATION_MISSING");
  const { executeLiveConversationTurn } = await import("@/server/conversation/live/runtime");
  return executeLiveConversationTurn({
    apiKey,
    caseId: demoCaseRef,
    actorRef: devActorRef,
    normalizedTurn,
  });
}

function getSourceIp(): string {
  // Development and Demo run as a direct Node listener without a trusted proxy.
  // Client-supplied forwarding headers must never create independent rate buckets.
  return "direct-local-connection";
}

function pruneCompletedResponses(nowMs = Date.now()): void {
  for (const [resultRef, entry] of completedResponses) {
    if (entry.expiresAtMs <= nowMs) completedResponses.delete(resultRef);
  }
}
