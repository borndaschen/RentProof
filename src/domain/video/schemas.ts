import { z } from "zod";
import { VIDEO_LIMITS, VIDEO_MIME_TYPE } from "./constants";

export const VideoInspectionSchema = z
  .object({
    container: z.literal("mp4"),
    durationMs: z.number().int().positive().safe(),
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
    frameRate: z.number().positive().finite(),
    videoStreamCount: z.literal(1),
    audioStreamCount: z.number().int().nonnegative().max(8),
  })
  .strict();

export const VideoFramePlanItemSchema = z
  .object({
    frameNo: z
      .number()
      .int()
      .nonnegative()
      .max(VIDEO_LIMITS.maxExtractedFrames - 1),
    timestampMs: z
      .number()
      .int()
      .nonnegative()
      .max(VIDEO_LIMITS.maxDurationMs - 1),
  })
  .strict();

export const ExtractedVideoFrameSchema = z
  .object({
    mime: z.literal("image/jpeg"),
    frameNo: z.number().int().nonnegative(),
    timestampMs: z.number().int().nonnegative(),
    width: z.number().int().positive().max(VIDEO_LIMITS.derivativeMaxLongEdge),
    height: z.number().int().positive().max(VIDEO_LIMITS.derivativeMaxLongEdge),
    byteLength: z.number().int().positive().max(VIDEO_LIMITS.maxFrameBytes),
    bytes: z.instanceof(Uint8Array),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    metadataStripped: z.literal(true),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.bytes.byteLength !== frame.byteLength) {
      context.addIssue({ code: "custom", message: "VIDEO_FRAME_BYTE_LENGTH_MISMATCH" });
    }
  });

export const VideoUploadMetadataSchema = z
  .object({
    artifactId: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/u),
    declaredMime: z.literal(VIDEO_MIME_TYPE),
    byteLength: z.number().int().positive().max(VIDEO_LIMITS.maxBytes),
  })
  .strict();

export type VideoInspection = z.infer<typeof VideoInspectionSchema>;
export type VideoFramePlanItem = z.infer<typeof VideoFramePlanItemSchema>;
export type ExtractedVideoFrame = z.infer<typeof ExtractedVideoFrameSchema>;
export type VideoUploadMetadata = z.infer<typeof VideoUploadMetadataSchema>;
