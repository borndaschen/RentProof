import { z } from "zod";
import { ActorContextSchema, type ActorContext } from "@/application/repositories";
import {
  RealArtifactReservationSchema,
  StoredArtifactPathsSchema,
  type StoredArtifactPaths,
} from "@/application/real-demo";
import {
  PendingOcrConfirmationSchema,
  type ConfirmedOcrPages,
} from "@/application/ocr/confirm-ocr";

export const ProcessingRecordSchema = z
  .object({
    actor: ActorContextSchema,
    reservation: RealArtifactReservationSchema,
    idempotencyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    expectedRevision: z.number().int().nonnegative().safe(),
    policyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    type: z.enum(["contract.ocr", "evidence.video_frames"]),
    state: z.enum(["queued", "requires_confirmation", "available", "failed", "cancelled"]),
    stored: StoredArtifactPathsSchema,
    confirmation: PendingOcrConfirmationSchema.nullable(),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,95}$/u)
      .nullable(),
    jobId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{20,128}$/u)
      .nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    const prefix = `${record.reservation.caseId}/${record.reservation.artifactId}`;
    if (
      record.stored.originalRelativePath !== `${prefix}/original.enc` ||
      (record.stored.derivativeRelativePath !== null &&
        record.stored.derivativeRelativePath !== `${prefix}/derivative.enc`) ||
      (record.stored.extractedTextRelativePath !== null &&
        record.stored.extractedTextRelativePath !== `${prefix}/extracted-text.enc`) ||
      (record.type === "contract.ocr"
        ? record.reservation.kind !== "contract_pdf"
        : record.reservation.kind !== "viewing_video")
    ) {
      context.addIssue({ code: "custom", message: "PROCESSING_BINDING_INVALID" });
    }
  });

export type ProcessingRecord = z.infer<typeof ProcessingRecordSchema>;
export interface PreparedArtifactWriter {
  writePrepared(input: {
    reservation: ProcessingRecord["reservation"];
    derivative?: { bytes: Uint8Array; sha256: string };
    extractedText?: string;
  }): Promise<StoredArtifactPaths>;
}
export interface ProcessingRepository {
  authorize(actor: ActorContext, caseId: string): Promise<{ revision: number; policyHash: string }>;
  find(actor: ActorContext, caseId: string, artifactId: string): Promise<ProcessingRecord | null>;
  findByKey(actor: ActorContext, caseId: string, hash: string): Promise<ProcessingRecord | null>;
  create(record: ProcessingRecord): Promise<void>;
  replace(record: ProcessingRecord, expectedState: ProcessingRecord["state"]): Promise<void>;
  finalize(
    record: ProcessingRecord,
    stored: StoredArtifactPaths,
    confirmation?: {
      confirmationId: string;
      pages: ConfirmedOcrPages;
      nowMs: number;
    },
  ): Promise<void>;
  findWork(actorRef: string, caseId: string, artifactId: string): Promise<ProcessingRecord | null>;
}

export function processingActorRef(actor: ActorContext): string {
  return actor.kind === "guest" ? actor.guestSessionId : actor.sessionId;
}
