import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { packVerifiedVideoFrames, unpackVerifiedVideoFrames } from "./frame-bundle";

function frame(frameNo: number, timestampMs: number, value: number) {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, value, 0xff, 0xd9]);
  return {
    mime: "image/jpeg" as const,
    frameNo,
    timestampMs,
    width: 2,
    height: 2,
    byteLength: bytes.byteLength,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    metadataStripped: true as const,
  };
}

describe("video frame bundle", () => {
  it("round-trips ordered, verified frame bytes without base64", () => {
    const frames = [frame(0, 0, 1), frame(1, 2_000, 2)];
    expect(unpackVerifiedVideoFrames(packVerifiedVideoFrames(frames))).toEqual(frames);
  });

  it("accepts prepared frames while excluding their runtime locator from the stored bundle", () => {
    const prepared = {
      ...frame(0, 0, 1),
      locator: {
        type: "video" as const,
        artifactId: "artifact_video_000000001",
        timestampMs: 0,
        frameNo: 0,
      },
    };
    expect(unpackVerifiedVideoFrames(packVerifiedVideoFrames([prepared]))).toEqual([
      frame(0, 0, 1),
    ]);
  });

  it("rejects reordered frames and tampered payloads", () => {
    expect(() => packVerifiedVideoFrames([frame(1, 0, 1)])).toThrow("VIDEO_FRAME_BUNDLE_INVALID");
    const bundle = packVerifiedVideoFrames([frame(0, 0, 1)]);
    bundle[bundle.byteLength - 1] = 0;
    expect(() => unpackVerifiedVideoFrames(bundle)).toThrow("VIDEO_FRAME_BUNDLE_INVALID");
  });
});
