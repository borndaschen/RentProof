import { VIDEO_LIMITS } from "./constants";
import { VideoInspectionSchema, type VideoFramePlanItem, type VideoInspection } from "./schemas";

export type VideoFailureCode =
  | "VIDEO_INPUT_INVALID"
  | "VIDEO_MP4_SIGNATURE_INVALID"
  | "VIDEO_DURATION_EXCEEDED"
  | "VIDEO_DIMENSIONS_EXCEEDED"
  | "VIDEO_FRAME_RATE_EXCEEDED"
  | "VIDEO_RUNTIME_UNAVAILABLE"
  | "VIDEO_RUNTIME_UNVERIFIED"
  | "VIDEO_PROBE_FAILED"
  | "VIDEO_EXTRACTION_FAILED"
  | "VIDEO_FRAME_CONTRACT_INVALID";

export type VideoFailure = Readonly<{ ok: false; code: VideoFailureCode }>;

export function hasMp4FileSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const boxSize =
    ((bytes[0] ?? 0) * 0x1000000 +
      (bytes[1] ?? 0) * 0x10000 +
      (bytes[2] ?? 0) * 0x100 +
      (bytes[3] ?? 0)) >>>
    0;
  return (
    boxSize >= 12 &&
    boxSize <= bytes.byteLength &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

export function validateVideoInspection(
  untrusted: unknown,
): { ok: true; value: VideoInspection } | VideoFailure {
  const parsed = VideoInspectionSchema.safeParse(untrusted);
  if (!parsed.success) return { ok: false, code: "VIDEO_PROBE_FAILED" };
  if (parsed.data.durationMs > VIDEO_LIMITS.maxDurationMs) {
    return { ok: false, code: "VIDEO_DURATION_EXCEEDED" };
  }
  const pixels = parsed.data.width * parsed.data.height;
  if (!Number.isSafeInteger(pixels) || pixels > VIDEO_LIMITS.maxPixelsPerFrame) {
    return { ok: false, code: "VIDEO_DIMENSIONS_EXCEEDED" };
  }
  if (parsed.data.frameRate > VIDEO_LIMITS.maxFrameRate) {
    return { ok: false, code: "VIDEO_FRAME_RATE_EXCEEDED" };
  }
  return { ok: true, value: parsed.data };
}

export function createDeterministicFramePlan(durationMs: number): readonly VideoFramePlanItem[] {
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > VIDEO_LIMITS.maxDurationMs
  ) {
    return [];
  }
  const result: VideoFramePlanItem[] = [];
  for (
    let timestampMs = 0;
    timestampMs < durationMs && result.length < VIDEO_LIMITS.maxExtractedFrames;
    timestampMs += VIDEO_LIMITS.frameIntervalMs
  ) {
    result.push({ frameNo: result.length, timestampMs });
  }
  return result;
}
