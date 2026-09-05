import { createHash } from "node:crypto";
import { z } from "zod";
import { ActorContextSchema, type ActorContext } from "@/application/repositories";
import { detectSensitiveConversationContent } from "@/application/conversation/security";
import type { OcrAssessment } from "@/domain/ocr";

const id = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const coordinate = z.number().min(0).max(1);
export const ConfirmableOcrPagesSchema = z
  .array(
    z
      .object({
        page: z.number().int().min(1).max(30),
        text: z.string().min(1).max(300_000),
        segments: z
          .array(
            z
              .object({
                text: z.string().min(1).max(2_000),
                startCodePoint: z.number().int().nonnegative(),
                endCodePoint: z.number().int().positive(),
                bbox: z.tuple([coordinate, coordinate, coordinate, coordinate]),
              })
              .strict(),
          )
          .min(1)
          .max(1_000),
      })
      .strict(),
  )
  .min(1)
  .max(30)
  .superRefine((pages, context) => {
    let total = 0;
    for (const [index, page] of pages.entries()) {
      const chars = [...page.text];
      total += chars.length;
      if (
        page.page !== index + 1 ||
        page.text !== page.text.normalize("NFC") ||
        page.text.includes("\0")
      ) {
        context.addIssue({ code: "custom", message: "OCR_PAGE_SET_INVALID" });
      }
      let expected = 0;
      for (const segment of page.segments) {
        const [x0, y0, x1, y1] = segment.bbox;
        if (
          segment.startCodePoint !== expected ||
          segment.endCodePoint > chars.length ||
          segment.endCodePoint <= segment.startCodePoint ||
          chars.slice(segment.startCodePoint, segment.endCodePoint).join("") !== segment.text ||
          x0 >= x1 ||
          y0 >= y1
        ) {
          context.addIssue({ code: "custom", message: "OCR_LOCATOR_INVALID" });
        }
        expected = segment.endCodePoint + 1;
      }
      if (page.segments.map((segment) => segment.text).join("\n") !== page.text) {
        context.addIssue({ code: "custom", message: "OCR_LOCATOR_INVALID" });
      }
    }
    if (total > 300_000) context.addIssue({ code: "custom", message: "OCR_TEXT_LIMIT_EXCEEDED" });
  });

export const PendingOcrConfirmationSchema = z
  .object({
    schemaVersion: z.literal("rentproof.ocr-confirmation.v1"),
    confirmationId: id,
    actor: ActorContextSchema,
    caseId: id,
    artifactId: id,
    expectedRevision: z.number().int().nonnegative().safe(),
    policyHash: hash,
    payloadHash: hash,
    createdAtMs: z.number().int().nonnegative().safe(),
    expiresAtMs: z.number().int().nonnegative().safe(),
    state: z.enum(["pending", "used"]),
  })
  .strict()
  .refine((value) => value.expiresAtMs - value.createdAtMs === 600_000);

export type PendingOcrConfirmation = z.infer<typeof PendingOcrConfirmationSchema>;
export type ConfirmedOcrPages = z.infer<typeof ConfirmableOcrPagesSchema>;

export function canonicalOcrPayloadHash(pages: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(ConfirmableOcrPagesSchema.parse(pages)))
    .digest("hex");
}

export function createOcrConfirmation(input: {
  assessment: OcrAssessment;
  actor: ActorContext;
  caseId: string;
  artifactId: string;
  expectedRevision: number;
  policyHash: string;
  confirmationId: string;
  nowMs: number;
}): { confirmation: PendingOcrConfirmation; pages: ConfirmedOcrPages } {
  if (input.assessment.status !== "requires_confirmation")
    throw new Error("OCR_CONFIRMATION_UNAVAILABLE");
  const pages = ConfirmableOcrPagesSchema.parse(input.assessment.pages);
  if (
    pages.some((page) => detectSensitiveConversationContent(page.text).decision === "hard_block")
  ) {
    throw new Error("OCR_AUTH_SECRET_DETECTED");
  }
  const confirmation = PendingOcrConfirmationSchema.parse({
    schemaVersion: "rentproof.ocr-confirmation.v1",
    confirmationId: input.confirmationId,
    actor: input.actor,
    caseId: input.caseId,
    artifactId: input.artifactId,
    expectedRevision: input.expectedRevision,
    policyHash: input.policyHash,
    payloadHash: canonicalOcrPayloadHash(pages),
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + 600_000,
    state: "pending",
  });
  return { confirmation, pages };
}

/** The repository must invoke this validation and consume in the same owner/revision transaction. */
export function validateOcrConfirmation(input: {
  pending: unknown;
  pages: unknown;
  actor: ActorContext;
  caseId: string;
  artifactId: string;
  confirmationId: string;
  revision: number;
  policyHash: string;
  explicitlyConfirmed: boolean;
  nowMs: number;
}): ConfirmedOcrPages {
  const pending = PendingOcrConfirmationSchema.parse(input.pending);
  const actor = ActorContextSchema.parse(input.actor);
  if (
    pending.caseId !== input.caseId ||
    pending.artifactId !== input.artifactId ||
    pending.confirmationId !== input.confirmationId ||
    JSON.stringify(pending.actor) !== JSON.stringify(actor)
  ) {
    throw new Error("OCR_CONFIRMATION_NOT_FOUND_OR_FORBIDDEN");
  }
  if (pending.state === "used") throw new Error("OCR_CONFIRMATION_USED");
  if (
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < pending.createdAtMs ||
    input.nowMs >= pending.expiresAtMs
  ) {
    throw new Error("OCR_CONFIRMATION_EXPIRED");
  }
  if (
    pending.expectedRevision !== input.revision ||
    pending.policyHash !== input.policyHash ||
    canonicalOcrPayloadHash(input.pages) !== pending.payloadHash
  ) {
    throw new Error("OCR_CONFIRMATION_STALE");
  }
  if (!input.explicitlyConfirmed) throw new Error("OCR_HUMAN_CONFIRMATION_REQUIRED");
  const pages = ConfirmableOcrPagesSchema.parse(input.pages);
  if (
    pages.some((page) => detectSensitiveConversationContent(page.text).decision === "hard_block")
  ) {
    throw new Error("OCR_AUTH_SECRET_DETECTED");
  }
  return pages;
}
