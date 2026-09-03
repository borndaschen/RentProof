import {
  CONVERSATION_LIMITS,
  OpaqueIdSchema,
  PendingConfirmationSchema,
} from "@/domain/conversation";
import { canonicalizeCandidatePayload, hashOpaqueConfirmationId } from "./canonical-payload";
import type { PendingConfirmationEntry } from "./ports";

export type CreatePendingConfirmationInput = Readonly<{
  confirmationId: string;
  actorRef: string;
  caseId: string;
  caseRevision: number;
  candidate: unknown;
  now: Date;
}>;

export function createPendingConfirmation(
  input: CreatePendingConfirmationInput,
): PendingConfirmationEntry {
  const confirmationId = OpaqueIdSchema.parse(input.confirmationId);
  const actorRef = OpaqueIdSchema.parse(input.actorRef);
  const caseId = OpaqueIdSchema.parse(input.caseId);
  const canonical = canonicalizeCandidatePayload(input.candidate);
  const createdAt = input.now.toISOString();
  const expiresAt = new Date(
    input.now.getTime() + CONVERSATION_LIMITS.confirmationTtlMs,
  ).toISOString();

  const record = PendingConfirmationSchema.parse({
    confirmationIdHash: hashOpaqueConfirmationId(confirmationId),
    actorRef,
    caseId,
    caseRevision: input.caseRevision,
    candidateType: canonical.payload.candidateType,
    canonicalPayloadHash: canonical.sha256,
    createdAt,
    expiresAt,
    status: "pending",
    consumedAt: null,
  });

  return { record, candidate: canonical.payload };
}
