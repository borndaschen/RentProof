import type { ExtractedVideoFrame, VideoFramePlanItem, VideoInspection } from "@/domain/video";

export type VideoRuntimeReadiness =
  | Readonly<{ ready: true; ffmpegVersion: string; ffprobeVersion: string }>
  | Readonly<{ ready: false; reason: "unavailable" | "unverified" }>;

export interface VideoRuntimeAvailabilityPort {
  check(): Promise<VideoRuntimeReadiness>;
}

export interface VideoMetadataProbePort {
  inspect(bytes: Uint8Array): Promise<unknown>;
}

export interface VideoFrameExtractorPort {
  extract(
    input: Readonly<{
      sourceBytes: Uint8Array;
      inspection: VideoInspection;
      plan: readonly VideoFramePlanItem[];
    }>,
  ): Promise<unknown>;
}

export interface VideoFrameVerifierPort {
  verify(frame: ExtractedVideoFrame): Promise<boolean>;
}

export type PreparedVideoFrame = ExtractedVideoFrame &
  Readonly<{
    locator: {
      type: "video";
      artifactId: string;
      timestampMs: number;
      frameNo: number;
    };
  }>;
