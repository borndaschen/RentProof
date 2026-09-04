import { describe, expect, it } from "vitest";
import {
  VIDEO_LIMITS,
  createDeterministicFramePlan,
  hasMp4FileSignature,
  validateVideoInspection,
} from "./index";

const validInspection = {
  container: "mp4",
  durationMs: 30_000,
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoStreamCount: 1,
  audioStreamCount: 1,
} as const;

describe("video domain", () => {
  it("recognizes only a bounded leading ftyp box", () => {
    expect(hasMp4FileSignature(new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 0, 0, 0, 0]))).toBe(
      true,
    );
    expect(hasMp4FileSignature(new Uint8Array(11))).toBe(false);
    expect(hasMp4FileSignature(new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 0, 0, 0, 0]))).toBe(
      false,
    );
    expect(hasMp4FileSignature(new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112, 0, 0, 0, 0]))).toBe(
      false,
    );
    expect(hasMp4FileSignature(new Uint8Array([0, 0, 0, 12, 109, 111, 111, 118, 0, 0, 0, 0]))).toBe(
      false,
    );
  });

  it("validates probe metadata and fixed safety limits", () => {
    expect(validateVideoInspection(validInspection)).toEqual({ ok: true, value: validInspection });
    expect(validateVideoInspection({})).toEqual({ ok: false, code: "VIDEO_PROBE_FAILED" });
    expect(validateVideoInspection({ ...validInspection, durationMs: 30_001 })).toEqual({
      ok: false,
      code: "VIDEO_DURATION_EXCEEDED",
    });
    expect(validateVideoInspection({ ...validInspection, width: 7680, height: 4320 })).toEqual({
      ok: false,
      code: "VIDEO_DIMENSIONS_EXCEEDED",
    });
    expect(validateVideoInspection({ ...validInspection, frameRate: 61 })).toEqual({
      ok: false,
      code: "VIDEO_FRAME_RATE_EXCEEDED",
    });
  });

  it("builds stable timestamps without sampling beyond duration", () => {
    const plan = createDeterministicFramePlan(30_000);
    expect(plan).toHaveLength(VIDEO_LIMITS.maxExtractedFrames);
    expect(plan[0]).toEqual({ frameNo: 0, timestampMs: 0 });
    expect(plan[14]).toEqual({ frameNo: 14, timestampMs: 28_000 });
    expect(createDeterministicFramePlan(1)).toEqual([{ frameNo: 0, timestampMs: 0 }]);
    expect(createDeterministicFramePlan(0)).toEqual([]);
    expect(createDeterministicFramePlan(30_001)).toEqual([]);
    expect(createDeterministicFramePlan(1.5)).toEqual([]);
  });
});
