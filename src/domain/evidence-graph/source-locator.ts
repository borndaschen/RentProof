import { z } from "zod";
import { EvidenceGraphIdSchema, NonBlankTextSchema } from "./primitives";

const normalizedCoordinate = z.number().min(0).max(1);
const textOffset = z.number().int().nonnegative().max(300_000);

export const ImageBoundingBoxSchema = z
  .tuple([normalizedCoordinate, normalizedCoordinate, normalizedCoordinate, normalizedCoordinate])
  .superRefine(([xMin, yMin, xMax, yMax], context) => {
    if (xMin >= xMax) {
      context.addIssue({ code: "custom", message: "IMAGE_BBOX_X_RANGE_INVALID" });
    }
    if (yMin >= yMax) {
      context.addIssue({ code: "custom", message: "IMAGE_BBOX_Y_RANGE_INVALID" });
    }
  });

const ImageSourceLocatorSchema = z
  .object({
    type: z.literal("image"),
    locatorId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    bbox: ImageBoundingBoxSchema,
  })
  .strict();

const PdfSourceLocatorSchema = z
  .object({
    type: z.literal("pdf"),
    locatorId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    page: z.number().int().min(1).max(30),
    start: textOffset,
    end: textOffset,
    excerpt: NonBlankTextSchema,
  })
  .strict()
  .superRefine((locator, context) => {
    if (locator.start >= locator.end) {
      context.addIssue({ code: "custom", message: "PDF_TEXT_RANGE_INVALID" });
    }
  });

const TextSourceLocatorSchema = z
  .object({
    type: z.literal("text"),
    locatorId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    start: textOffset,
    end: textOffset,
    excerpt: NonBlankTextSchema,
  })
  .strict()
  .superRefine((locator, context) => {
    if (locator.start >= locator.end) {
      context.addIssue({ code: "custom", message: "TEXT_RANGE_INVALID" });
    }
  });

const VideoSourceLocatorSchema = z
  .object({
    type: z.literal("video"),
    locatorId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    timestampMs: z.number().int().nonnegative(),
    frameNo: z.number().int().nonnegative(),
  })
  .strict();

export const SourceLocatorSchema = z.discriminatedUnion("type", [
  ImageSourceLocatorSchema,
  PdfSourceLocatorSchema,
  TextSourceLocatorSchema,
  VideoSourceLocatorSchema,
]);

export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
