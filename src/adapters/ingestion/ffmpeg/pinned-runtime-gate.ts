import { z } from "zod";
import type { VideoRuntimeAvailabilityPort, VideoRuntimeReadiness } from "@/application/video";

const ToolIdentitySchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    version: z.string().min(1).max(200),
  })
  .strict();

export interface TrustedVideoToolProbePort {
  identify(tool: "ffmpeg" | "ffprobe"): Promise<unknown>;
}

export type PinnedVideoRuntimeConfig = Readonly<{
  ffmpegSha256: string;
  ffprobeSha256: string;
  ffmpegVersion: string;
  ffprobeVersion: string;
}>;

export class PinnedFfmpegRuntimeGate implements VideoRuntimeAvailabilityPort {
  readonly #config: PinnedVideoRuntimeConfig;
  readonly #probe: TrustedVideoToolProbePort;

  constructor(config: PinnedVideoRuntimeConfig, probe: TrustedVideoToolProbePort) {
    this.#config = config;
    this.#probe = probe;
  }

  async check(): Promise<VideoRuntimeReadiness> {
    let ffmpeg: unknown;
    let ffprobe: unknown;
    try {
      [ffmpeg, ffprobe] = await Promise.all([
        this.#probe.identify("ffmpeg"),
        this.#probe.identify("ffprobe"),
      ]);
    } catch {
      return { ready: false, reason: "unavailable" };
    }
    const parsedFfmpeg = ToolIdentitySchema.safeParse(ffmpeg);
    const parsedFfprobe = ToolIdentitySchema.safeParse(ffprobe);
    if (!parsedFfmpeg.success || !parsedFfprobe.success) {
      return { ready: false, reason: "unverified" };
    }
    if (
      parsedFfmpeg.data.sha256 !== this.#config.ffmpegSha256 ||
      parsedFfprobe.data.sha256 !== this.#config.ffprobeSha256 ||
      parsedFfmpeg.data.version !== this.#config.ffmpegVersion ||
      parsedFfprobe.data.version !== this.#config.ffprobeVersion
    ) {
      return { ready: false, reason: "unverified" };
    }
    return {
      ready: true,
      ffmpegVersion: parsedFfmpeg.data.version,
      ffprobeVersion: parsedFfprobe.data.version,
    };
  }
}
