import { OpaqueIdSchema } from "@/domain/conversation";
import { canonicalizeCandidatePayload, hashOpaqueConfirmationId } from "./canonical-payload";
import type { ConsumePendingConfirmationResult, PendingConfirmationRepository } from "./ports";

export type ConsumeConfirmationInput = Readonly<{
  confirmationId: string;
  actorRef: string;
  caseId: string;
  currentCaseRevision: number;
  serverExpectedCandidate: unknown;
  now: Date;
}>;

export function consumePendingConfirmation(
  repository: PendingConfirmationRepository,
  input: ConsumeConfirmationInput,
): Promise<ConsumePendingConfirmationResult> {
  const confirmationId = OpaqueIdSchema.safeParse(input.confirmationId);
  if (!confirmationId.success) {
    return Promise.resolve({ ok: false, code: "CONFIRMATION_NOT_FOUND" });
  }

  const actorRef = OpaqueIdSchema.parse(input.actorRef);
  const caseId = OpaqueIdSchema.parse(input.caseId);
  const expected = canonicalizeCandidatePayload(input.serverExpectedCandidate);

  return repository.consume({
    confirmationIdHash: hashOpaqueConfirmationId(confirmationId.data),
    binding: {
      actorRef,
      caseId,
      caseRevision: input.currentCaseRevision,
      candidateType: expected.payload.candidateType,
      canonicalPayloadHash: expected.sha256,
    },
    now: input.now,
  });
}
