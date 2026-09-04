import { describe, expect, it, vi } from "vitest";
import { prepareVideoEvidence } from "./prepare-video-evidence";

const bytes = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 0, 0, 0, 0]);
const metadata = { artifactId: "video_artifact_01", declaredMime: "video/mp4", byteLength: 12 };
const inspection = {
  container: "mp4",
  durationMs: 2_001,
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoStreamCount: 1,
  audioStreamCount: 1,
} as const;
const hash = "a".repeat(64);
const frameBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const frames = [0, 2_000].map((timestampMs, frameNo) => ({
  mime: "image/jpeg",
  frameNo,
  timestampMs,
  width: 1920,
  height: 1080,
  byteLength: frameBytes.byteLength,
  bytes: frameBytes,
  sha256: hash,
  metadataStripped: true,
}));

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    runtime: {
      check: vi.fn().mockResolvedValue({ ready: true, ffmpegVersion: "7", ffprobeVersion: "7" }),
    },
    probe: { inspect: vi.fn().mockResolvedValue(inspection) },
    extractor: { extract: vi.fn().mockResolvedValue(frames) },
    verifier: { verify: vi.fn().mockResolvedValue(true) },
    ...overrides,
  };
}

describe("prepareVideoEvidence", () => {
  it("returns deterministic frame locators and never represents audio analysis", async () => {
    const result = await prepareVideoEvidence(metadata, bytes, dependencies());
    expect(result).toMatchObject({ ok: true, audioAnalyzed: false });
    if (result.ok) {
      expect(result.frames.map((frame) => frame.locator)).toEqual([
        { type: "video", artifactId: "video_artifact_01", timestampMs: 0, frameNo: 0 },
        { type: "video", artifactId: "video_artifact_01", timestampMs: 2_000, frameNo: 1 },
      ]);
    }
  });

  it("rejects invalid metadata and non-MP4 bytes before touching tools", async () => {
    const deps = dependencies();
    await expect(
      prepareVideoEvidence({ ...metadata, byteLength: 11 }, bytes, deps),
    ).resolves.toEqual({ ok: false, code: "VIDEO_INPUT_INVALID" });
    await expect(prepareVideoEvidence(metadata, new Uint8Array(12), deps)).resolves.toEqual({
      ok: false,
      code: "VIDEO_MP4_SIGNATURE_INVALID",
    });
    expect(deps.runtime.check).not.toHaveBeenCalled();
  });

  it.each([
    [{ ready: false, reason: "unavailable" }, "VIDEO_RUNTIME_UNAVAILABLE"],
    [{ ready: false, reason: "unverified" }, "VIDEO_RUNTIME_UNVERIFIED"],
  ] as const)("fails closed when the runtime is %o", async (readiness, code) => {
    const result = await prepareVideoEvidence(
      metadata,
      bytes,
      dependencies({ runtime: { check: vi.fn().mockResolvedValue(readiness) } }),
    );
    expect(result).toEqual({ ok: false, code });
  });

  it("separates probe and extraction failures", async () => {
    await expect(
      prepareVideoEvidence(
        metadata,
        bytes,
        dependencies({ probe: { inspect: vi.fn().mockRejectedValue(new Error("probe")) } }),
      ),
    ).resolves.toEqual({ ok: false, code: "VIDEO_PROBE_FAILED" });
    await expect(
      prepareVideoEvidence(
        metadata,
        bytes,
        dependencies({ extractor: { extract: vi.fn().mockRejectedValue(new Error("extract")) } }),
      ),
    ).resolves.toEqual({ ok: false, code: "VIDEO_EXTRACTION_FAILED" });
  });

  it("rejects invalid inspection and every mismatched frame contract", async () => {
    await expect(
      prepareVideoEvidence(
        metadata,
        bytes,
        dependencies({ probe: { inspect: vi.fn().mockResolvedValue({}) } }),
      ),
    ).resolves.toEqual({ ok: false, code: "VIDEO_PROBE_FAILED" });
    await expect(
      prepareVideoEvidence(
        metadata,
        bytes,
        dependencies({ extractor: { extract: vi.fn().mockResolvedValue([]) } }),
      ),
    ).resolves.toEqual({ ok: false, code: "VIDEO_FRAME_CONTRACT_INVALID" });
    await expect(
      prepareVideoEvidence(
        metadata,
        bytes,
        dependencies({
          extractor: {
            extract: vi.fn().mockResolvedValue([frames[0], { ...frames[1], timestampMs: 1 }]),
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "VIDEO_FRAME_CONTRACT_INVALID" });
    await expect(
      prepareVideoEvidence(
        metadata,
        bytes,
        dependencies({
          extractor: { extract: vi.fn().mockResolvedValue([frames[0], { broken: true }]) },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "VIDEO_FRAME_CONTRACT_INVALID" });
  });

  it("fails closed when derivative verification rejects or throws", async () => {
    await expect(
      prepareVideoEvidence(
        metadata,
        bytes,
        dependencies({ verifier: { verify: vi.fn().mockResolvedValue(false) } }),
      ),
    ).resolves.toEqual({ ok: false, code: "VIDEO_FRAME_CONTRACT_INVALID" });
    await expect(
      prepareVideoEvidence(
        metadata,
        bytes,
        dependencies({ verifier: { verify: vi.fn().mockRejectedValue(new Error("verify")) } }),
      ),
    ).resolves.toEqual({ ok: false, code: "VIDEO_FRAME_CONTRACT_INVALID" });
  });
});
