import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  ApplyMaterialCandidateUseCase,
  createEmptySingleCase,
  InMemorySingleCaseRepository,
} from "@/application/case-commands";
import { InMemoryConversationRateLimiter } from "@/application/conversation/security";
import type { MaterialCandidatePayload } from "@/domain/conversation";
import { OpaqueIdSchema } from "@/domain/conversation";
import { MaterialConfirmationService } from "./material-confirmation-service";

export const syntheticActor = {
  kind: "guest" as const,
  guestId: "fixture_guest_actor_0001",
  guestSessionId: "fixture_guest_session_01",
};
export const syntheticCaseId = "demo_case_golden_v1_01";

const repository = new InMemorySingleCaseRepository(
  createEmptySingleCase({
    caseId: syntheticCaseId,
    owner: {
      kind: "guest",
      guestId: syntheticActor.guestId,
      guestSessionId: syntheticActor.guestSessionId,
    },
  }),
);
const service = new MaterialConfirmationService({
  repository,
  applyCandidate: new ApplyMaterialCandidateUseCase(repository),
  clock: { now: () => new Date() },
  idGenerator: { nextId: () => randomUUID() },
});
const csrfHashes = new Map<string, { csrfHash: string; expiresAtMs: number }>();
const issueRateLimiter = new InMemoryConversationRateLimiter();

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function issueSyntheticMaterialConfirmation(candidate: MaterialCandidatePayload) {
  pruneCsrfHashes();
  const issued = await service.issue({
    actor: syntheticActor,
    caseId: syntheticCaseId,
    candidate,
  });
  if (!issued.ok) return issued;
  const csrfToken = randomUUID();
  csrfHashes.set(hash(issued.confirmationId), {
    csrfHash: hash(csrfToken),
    expiresAtMs: Date.parse(issued.expiresAt),
  });
  return { ...issued, csrfToken };
}

export function allowSyntheticConfirmationIssue() {
  return issueRateLimiter.consume({
    actorRef: "fixture_confirmation_actor_01",
    sourceIp: "direct-synthetic-confirmation",
  });
}

export async function consumeSyntheticMaterialConfirmation(input: {
  confirmationId: string;
  csrfToken: string;
}) {
  pruneCsrfHashes();
  if (
    !OpaqueIdSchema.safeParse(input.confirmationId).success ||
    !OpaqueIdSchema.safeParse(input.csrfToken).success
  ) {
    return { ok: false as const, code: "CONFIRMATION_CSRF_INVALID" as const };
  }
  const key = hash(input.confirmationId);
  const expected = csrfHashes.get(key);
  const actual = hash(input.csrfToken);
  if (
    expected === undefined ||
    expected.csrfHash.length !== actual.length ||
    !timingSafeEqual(Buffer.from(expected.csrfHash, "hex"), Buffer.from(actual, "hex"))
  ) {
    return { ok: false as const, code: "CONFIRMATION_CSRF_INVALID" as const };
  }
  csrfHashes.delete(key);
  return service.consume({
    confirmationId: input.confirmationId,
    actor: syntheticActor,
    caseId: syntheticCaseId,
  });
}

export async function issueLiveMaterialConfirmation(candidate: MaterialCandidatePayload) {
  return issueSyntheticMaterialConfirmation(candidate);
}

export function getLiveSyntheticCaseAggregate() {
  return repository.load(syntheticCaseId);
}

function pruneCsrfHashes(nowMs = Date.now()): void {
  for (const [key, entry] of csrfHashes) {
    if (entry.expiresAtMs <= nowMs) csrfHashes.delete(key);
  }
}
