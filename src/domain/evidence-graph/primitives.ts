import { z } from "zod";

export const EvidenceGraphIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
export const EvidenceKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/u);
export const ReasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u);

export const NonBlankTextSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => value.trim().length > 0, "TEXT_MUST_NOT_BE_BLANK");

export const QualityFlagSchema = z.enum([
  "model_low_confidence",
  "blurred",
  "partial_coverage",
  "unreadable_text",
  "occluded",
]);

export const QualityFlagsSchema = z
  .array(QualityFlagSchema)
  .max(5)
  .superRefine((flags, context) => {
    if (new Set(flags).size !== flags.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_QUALITY_FLAG" });
    }
  });

export const ModelConfidenceSchema = z.number().min(0).max(1);
