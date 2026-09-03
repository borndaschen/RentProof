import { z } from "zod";
import { MaterialCandidatePayloadSchema, PendingConfirmationSchema } from "@/domain/conversation";
import type { MaterialCandidatePayload } from "@/domain/conversation";
import type { ConfirmationConsumeErrorCode } from "./errors";

export type PendingConfirmationRecord = z.infer<typeof PendingConfirmationSchema>;
export type CandidateType = MaterialCandidatePayload["candidateType"];

export type PendingConfirmationEntry = Readonly<{
  record: PendingConfirmationRecord;
  candidate: MaterialCandidatePayload;
}>;

export type ConfirmationBinding = Readonly<{
  actorRef: string;
  caseId: string;
  caseRevision: number;
  candidateType: CandidateType;
  canonicalPayloadHash: string;
}>;

export type ConsumePendingConfirmationInput = Readonly<{
  confirmationIdHash: string;
  binding: ConfirmationBinding;
  now: Date;
}>;

export type ConsumePendingConfirmationResult =
  | Readonly<{
      ok: true;
      entry: PendingConfirmationEntry;
    }>
  | Readonly<{
      ok: false;
      code: ConfirmationConsumeErrorCode;
    }>;

export interface PendingConfirmationRepository {
  insert(entry: PendingConfirmationEntry): Promise<"inserted" | "conflict">;
  consume(input: ConsumePendingConfirmationInput): Promise<ConsumePendingConfirmationResult>;
  revokeByIdHash(confirmationIdHash: string): Promise<boolean>;
}

export function validatePendingConfirmationEntry(
  entry: PendingConfirmationEntry,
): PendingConfirmationEntry {
  return {
    record: PendingConfirmationSchema.parse(entry.record),
    candidate: MaterialCandidatePayloadSchema.parse(entry.candidate),
  };
}
