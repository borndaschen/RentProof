import { describe, expect, it } from "vitest";
import { PinnedFfmpegRuntimeGate, type TrustedVideoToolProbePort } from "./pinned-runtime-gate";

const a = "a".repeat(64);
const b = "b".repeat(64);
const config = {
  ffmpegSha256: a,
  ffprobeSha256: b,
  ffmpegVersion: "7.1.1",
  ffprobeVersion: "7.1.1",
};

class Probe implements TrustedVideoToolProbePort {
  constructor(private readonly values: Record<"ffmpeg" | "ffprobe", unknown>) {}
  async identify(tool: "ffmpeg" | "ffprobe"): Promise<unknown> {
    return this.values[tool];
  }
}

describe("PinnedFfmpegRuntimeGate", () => {
  it("accepts only exact version and SHA-256 pins", async () => {
    const gate = new PinnedFfmpegRuntimeGate(
      config,
      new Probe({
        ffmpeg: { sha256: a, version: "7.1.1" },
        ffprobe: { sha256: b, version: "7.1.1" },
      }),
    );
    await expect(gate.check()).resolves.toEqual({
      ready: true,
      ffmpegVersion: "7.1.1",
      ffprobeVersion: "7.1.1",
    });
  });

  it("fails closed for missing, malformed, hash-mismatched, or version-mismatched tools", async () => {
    const unavailable: TrustedVideoToolProbePort = {
      identify: async () => {
        throw new Error("missing");
      },
    };
    await expect(new PinnedFfmpegRuntimeGate(config, unavailable).check()).resolves.toEqual({
      ready: false,
      reason: "unavailable",
    });
    await expect(
      new PinnedFfmpegRuntimeGate(config, new Probe({ ffmpeg: {}, ffprobe: {} })).check(),
    ).resolves.toEqual({ ready: false, reason: "unverified" });
    await expect(
      new PinnedFfmpegRuntimeGate(
        config,
        new Probe({
          ffmpeg: { sha256: b, version: "7.1.1" },
          ffprobe: { sha256: b, version: "7.1.1" },
        }),
      ).check(),
    ).resolves.toEqual({ ready: false, reason: "unverified" });
    await expect(
      new PinnedFfmpegRuntimeGate(
        config,
        new Probe({
          ffmpeg: { sha256: a, version: "8" },
          ffprobe: { sha256: b, version: "7.1.1" },
        }),
      ).check(),
    ).resolves.toEqual({ ready: false, reason: "unverified" });
  });
});
