import { createHash } from "node:crypto";
import { createListingUrlFetcher } from "@/adapters/listing-url";
import { normalizeConversationTurn } from "@/application/conversation/normalize-turn";
import {
  detectSensitiveConversationContent,
  InMemoryConversationRateLimiter,
  InMemoryPiiAcknowledgementStore,
} from "@/application/conversation/security";
import { createListingUrlService } from "@/application/listing-url";
import type { ActorContext } from "@/application/repositories";
import { recognizeRealConversationIntent } from "@/application/real-demo/conversation-intent";
import { OpaqueIdSchema } from "@/domain/conversation";
import { resolveCurrentCaseActor } from "@/server/auth/current-actor";
import { validateSelfHostedAuthMutation } from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";
import { getRealDemoRuntime } from "@/server/real-demo";

export const runtime = "nodejs";

const pendingListingUrls = new Map<
  string,
  {
    expectedRevision: number;
    sourceUrl: string;
    text: string;
    contentHash: string;
    expiresAt: number;
  }
>();
const rateLimiter = new InMemoryConversationRateLimiter();
const piiAcknowledgements = new InMemoryPiiAcknowledgementStore();
const activeCases = new Set<string>();
const completedTurns = new Map<
  string,
  { payloadHash: string; response: Record<string, unknown> | null; expiresAt: number }
>();

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
    !validateSelfHostedAuthMutation(request, environment)
  ) {
    return errorResponse(404, "REAL_DEMO_ROUTE_UNAVAILABLE");
  }
  let normalized: ReturnType<typeof normalizeConversationTurn>;
  try {
    const bytes = await readBoundedBody(request);
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    const text =
      typeof parsed === "object" &&
      parsed !== null &&
      Object.keys(parsed).length === 1 &&
      typeof Reflect.get(parsed, "text") === "string"
        ? Reflect.get(parsed, "text")
        : null;
    if (typeof text !== "string") throw new Error("INVALID");
    normalized = normalizeConversationTurn(new TextEncoder().encode(text));
  } catch {
    return errorResponse(400, "CONVERSATION_ENCODING_INVALID");
  }
  if (!normalized.ok) {
    return errorResponse(
      normalized.code === "CONVERSATION_TURN_TOO_LARGE" ? 413 : 400,
      normalized.code,
    );
  }
  const sensitive = detectSensitiveConversationContent(normalized.value);
  if (sensitive.decision === "hard_block") return errorResponse(422, "AUTH_SECRET_DETECTED");

  try {
    const actor = await resolveCurrentCaseActor(request);
    const { caseId } = await context.params;
    if (!actor) return errorResponse(401, "REAL_DEMO_AUTH_REQUIRED");
    const actorRef = actor.kind === "user" ? actor.userId : actor.guestSessionId;
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!OpaqueIdSchema.safeParse(idempotencyKey).success) {
      return errorResponse(400, "IDEMPOTENCY_KEY_REQUIRED");
    }
    pruneCompletedTurns();
    const turnKey = `${actorRef}:${caseId}:${idempotencyKey}`;
    const payloadHash = createHash("sha256").update(normalized.value, "utf8").digest("hex");
    const previous = completedTurns.get(turnKey);
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        return errorResponse(409, "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
      }
      return previous.response
        ? Response.json(previous.response, { headers: privateHeaders() })
        : errorResponse(409, "CONVERSATION_TURN_IN_PROGRESS");
    }
    const rate = rateLimiter.consume({
      actorRef,
      sourceIp: request.headers.get("x-forwarded-for") ?? "verified-direct-client",
    });
    if (!rate.ok) {
      return Response.json(
        { error: { code: rate.code } },
        {
          status: 429,
          headers: {
            ...privateHeaders(),
            "Retry-After": String(rate.retryAfterSeconds),
          },
        },
      );
    }
    if (activeCases.has(caseId)) return errorResponse(409, "CONVERSATION_TURN_IN_PROGRESS");
    const turnRecord = {
      payloadHash,
      response: null as Record<string, unknown> | null,
      expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
    };
    completedTurns.set(turnKey, turnRecord);
    activeCases.add(caseId);
    let completed = false;
    const respond = (payload: Record<string, unknown>): Response => {
      turnRecord.response = payload;
      completed = true;
      return Response.json(payload, { headers: privateHeaders() });
    };
    try {
      const realRuntime = await getRealDemoRuntime();
      const caseContext = await realRuntime.service.getConversationContext(actor, caseId);
      if (sensitive.decision === "warning_required") {
        const acknowledgementId = request.headers.get("pii-acknowledgement");
        if (!acknowledgementId) {
          const acknowledgement = piiAcknowledgements.issue({
            actorRef,
            caseId,
            caseRevision: caseContext.revision,
            payloadHash,
            detectorVersion: sensitive.detectorVersion,
          });
          return Response.json(
            {
              error: { code: "PII_WARNING_REQUIRED" },
              acknowledgementId: acknowledgement.acknowledgementId,
              expiresAt: acknowledgement.expiresAt,
              piiKinds: sensitive.piiKinds,
            },
            { status: 422, headers: privateHeaders() },
          );
        }
        const consumed = piiAcknowledgements.consume({
          acknowledgementId,
          actorRef,
          caseId,
          expectedCaseRevision: caseContext.revision,
          payloadHash,
        });
        if (!consumed.ok) return errorResponse(409, consumed.code);
      }
      const intent = recognizeRealConversationIntent(normalized.value);
      const pendingKey = actorCaseKey(actor, caseId);
      prunePending();
      if (intent.kind === "listing_url_candidate") {
        const allowedHosts = parseAllowedListingHosts(
          process.env["RENTPROOF_LISTING_URL_ALLOWED_HOSTS"],
        );
        if (allowedHosts.length === 0) return errorResponse(422, "LISTING_URL_HOST_NOT_CONFIGURED");
        try {
          const extracted = await createListingUrlService(
            createListingUrlFetcher({ allowedHosts }),
          ).extract(intent.url);
          pendingListingUrls.set(pendingKey, {
            expectedRevision: caseContext.revision,
            sourceUrl: extracted.sourceUrl,
            text: extracted.text,
            contentHash: createHash("sha256").update(extracted.text, "utf8").digest("hex"),
            expiresAt: Date.now() + 10 * 60 * 1_000,
          });
          return respond({
            schemaVersion: "rentproof.real-conversation-intent.v1",
            intent,
            caseRevision: caseContext.revision,
            reply:
              "已安全擷取公開頁面。若是正確物件，請輸入「確認加入這個租屋連結」；確認前不會成為案件證據。",
          });
        } catch {
          return errorResponse(422, "LISTING_URL_FETCH_FAILED");
        }
      }
      if (intent.kind === "confirm_listing_url") {
        const pending = pendingListingUrls.get(pendingKey);
        if (!pending || pending.expiresAt <= Date.now()) {
          pendingListingUrls.delete(pendingKey);
          return errorResponse(409, "LISTING_URL_CONFIRMATION_EXPIRED");
        }
        if (pending.expectedRevision !== caseContext.revision) {
          pendingListingUrls.delete(pendingKey);
          return errorResponse(409, "LISTING_URL_CONFIRMATION_STALE");
        }
        await realRuntime.service.saveListingUrlSource(actor, {
          caseId,
          expectedRevision: pending.expectedRevision,
          sourceUrl: pending.sourceUrl,
          text: pending.text,
          contentHash: pending.contentHash,
        });
        pendingListingUrls.delete(pendingKey);
        return respond({
          schemaVersion: "rentproof.real-conversation-intent.v1",
          intent: { kind: "listing_url_added" },
          caseRevision: caseContext.revision + 1,
          reply: "租屋連結已加入案件；頁面文字會以來源定位方式進行分析。",
        });
      }
      return respond({
        schemaVersion: "rentproof.real-conversation-intent.v1",
        intent,
        caseRevision: caseContext.revision,
        reply: replyFor(intent.kind, caseContext.artifactKinds, caseContext.listingUrlAvailable),
      });
    } finally {
      activeCases.delete(caseId);
      if (!completed) completedTurns.delete(turnKey);
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "REAL_DEMO_AUTH_REQUIRED") return errorResponse(401, code);
    if (code === "REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN") return errorResponse(404, code);
    return errorResponse(503, "REAL_DEMO_UNAVAILABLE");
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) throw new Error("BODY_REQUIRED");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 8_192) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function replyFor(kind: string, artifacts: readonly string[], listingUrlAvailable = false): string {
  if (kind === "start_analysis") {
    const ready =
      (artifacts.includes("listing_image") || listingUrlAvailable) &&
      artifacts.some((value) => value === "viewing_image" || value === "follow_up_image") &&
      artifacts.includes("contract_pdf");
    return ready ? "已理解你要開始分析。" : "已理解你要分析，但目前資料還沒備齊。";
  }
  if (kind === "listing_url_candidate") return "已辨識租屋連結；完成安全擷取與確認後才會加入案件。";
  if (kind === "clarification_needed") return "一次請提供一個租屋連結，避免分析錯誤的物件。";
  return "已收到這段說明；它不會直接改寫案件結論。";
}

function actorCaseKey(actor: ActorContext | null, caseId: string): string {
  if (!actor) return `none:${caseId}`;
  return `${actor.kind}:${actor.kind === "user" ? actor.userId : actor.guestSessionId}:${caseId}`;
}

function parseAllowedListingHosts(value: string | undefined): readonly string[] {
  if (!value) return [];
  const hosts = value.split(",").map((host) => host.trim().toLowerCase());
  return hosts.every(
    (host) => /^[a-z0-9.-]+$/u.test(host) && !host.startsWith(".") && !host.endsWith("."),
  )
    ? [...new Set(hosts)]
    : [];
}

function prunePending(now = Date.now()): void {
  for (const [key, pending] of pendingListingUrls) {
    if (pending.expiresAt <= now) pendingListingUrls.delete(key);
  }
}

function pruneCompletedTurns(now = Date.now()): void {
  for (const [key, turn] of completedTurns) {
    if (turn.expiresAt <= now) completedTurns.delete(key);
  }
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: privateHeaders() });
}

function privateHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}
