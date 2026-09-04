import { createHash } from "node:crypto";
import { z } from "zod";
import { ExtractedVideoFrameSchema, VIDEO_LIMITS, type ExtractedVideoFrame } from "@/domain/video";

const MAGIC = new TextEncoder().encode("RENTPROOF-VFRAME-1\0");
const HEADER_LIMIT = 64 * 1024;
export const VIDEO_FRAME_BUNDLE_MAX_BYTES = 25 * 1024 * 1024;

const HeaderSchema = z
  .object({
    schemaVersion: z.literal("rentproof.video-frame-bundle.v1"),
    frames: z
      .array(
        z
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
            width: z.number().int().positive().max(VIDEO_LIMITS.derivativeMaxLongEdge),
            height: z.number().int().positive().max(VIDEO_LIMITS.derivativeMaxLongEdge),
            byteLength: z.number().int().positive().max(VIDEO_LIMITS.maxFrameBytes),
            offset: z.number().int().nonnegative().safe(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .min(1)
      .max(VIDEO_LIMITS.maxExtractedFrames),
  })
  .strict();

export function packVerifiedVideoFrames(frames: readonly ExtractedVideoFrame[]): Uint8Array {
  const candidates = frames.map((frame) => ({
    mime: frame.mime,
    frameNo: frame.frameNo,
    timestampMs: frame.timestampMs,
    width: frame.width,
    height: frame.height,
    byteLength: frame.byteLength,
    bytes: frame.bytes,
    sha256: frame.sha256,
    metadataStripped: frame.metadataStripped,
  }));
  const parsed = z
    .array(ExtractedVideoFrameSchema)
    .min(1)
    .max(VIDEO_LIMITS.maxExtractedFrames)
    .parse(candidates);
  let offset = 0;
  const header = {
    schemaVersion: "rentproof.video-frame-bundle.v1" as const,
    frames: parsed.map((frame, index) => {
      if (
        frame.frameNo !== index ||
        (index > 0 && frame.timestampMs <= (parsed[index - 1]?.timestampMs ?? -1))
      ) {
        throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
      }
      const entry = {
        frameNo: frame.frameNo,
        timestampMs: frame.timestampMs,
        width: frame.width,
        height: frame.height,
        byteLength: frame.byteLength,
        offset,
        sha256: frame.sha256,
      };
      offset += frame.byteLength;
      return entry;
    }),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  if (headerBytes.byteLength > HEADER_LIMIT) throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
  const total = MAGIC.byteLength + 4 + headerBytes.byteLength + offset;
  if (!Number.isSafeInteger(total) || total > VIDEO_FRAME_BUNDLE_MAX_BYTES) {
    throw new Error("VIDEO_FRAME_BUNDLE_TOO_LARGE");
  }
  const result = new Uint8Array(total);
  result.set(MAGIC, 0);
  new DataView(result.buffer).setUint32(MAGIC.byteLength, headerBytes.byteLength, false);
  const payloadStart = MAGIC.byteLength + 4 + headerBytes.byteLength;
  result.set(headerBytes, MAGIC.byteLength + 4);
  for (const frame of parsed) {
    const entry = header.frames[frame.frameNo];
    if (entry === undefined) throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
    result.set(frame.bytes, payloadStart + entry.offset);
  }
  return result;
}

export function unpackVerifiedVideoFrames(bundle: Uint8Array): readonly ExtractedVideoFrame[] {
  if (
    bundle.byteLength > VIDEO_FRAME_BUNDLE_MAX_BYTES ||
    bundle.byteLength < MAGIC.byteLength + 5
  ) {
    throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
  }
  if (!MAGIC.every((value, index) => bundle[index] === value)) {
    throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
  }
  const headerLength = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength).getUint32(
    MAGIC.byteLength,
    false,
  );
  if (headerLength < 1 || headerLength > HEADER_LIMIT)
    throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
  const payloadStart = MAGIC.byteLength + 4 + headerLength;
  if (payloadStart >= bundle.byteLength) throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bundle.subarray(MAGIC.byteLength + 4, payloadStart),
      ),
    );
  } catch {
    throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
  }
  const header = HeaderSchema.parse(decoded);
  let expectedOffset = 0;
  const frames = header.frames.map((entry, index) => {
    if (
      entry.frameNo !== index ||
      entry.offset !== expectedOffset ||
      (index > 0 && entry.timestampMs <= (header.frames[index - 1]?.timestampMs ?? -1))
    ) {
      throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
    }
    const end = entry.offset + entry.byteLength;
    if (!Number.isSafeInteger(end) || payloadStart + end > bundle.byteLength) {
      throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
    }
    const bytes = Uint8Array.from(bundle.subarray(payloadStart + entry.offset, payloadStart + end));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
    }
    expectedOffset = end;
    return ExtractedVideoFrameSchema.parse({
      mime: "image/jpeg",
      frameNo: entry.frameNo,
      timestampMs: entry.timestampMs,
      width: entry.width,
      height: entry.height,
      byteLength: entry.byteLength,
      bytes,
      sha256: entry.sha256,
      metadataStripped: true,
    });
  });
  if (payloadStart + expectedOffset !== bundle.byteLength) {
    throw new Error("VIDEO_FRAME_BUNDLE_INVALID");
  }
  return frames;
}
