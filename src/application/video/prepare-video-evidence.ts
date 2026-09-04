import {
  ExtractedVideoFrameSchema,
  VideoUploadMetadataSchema,
  createDeterministicFramePlan,
  hasMp4FileSignature,
  validateVideoInspection,
  type VideoFailure,
} from "@/domain/video";
import type {
  PreparedVideoFrame,
  VideoFrameExtractorPort,
  VideoMetadataProbePort,
  VideoRuntimeAvailabilityPort,
  VideoFrameVerifierPort,
} from "./ports";

export type PrepareVideoEvidenceResult =
  | Readonly<{ ok: true; frames: readonly PreparedVideoFrame[]; audioAnalyzed: false }>
  | VideoFailure;

export async function prepareVideoEvidence(
  untrustedMetadata: unknown,
  bytes: Uint8Array,
  dependencies: Readonly<{
    runtime: VideoRuntimeAvailabilityPort;
    probe: VideoMetadataProbePort;
    extractor: VideoFrameExtractorPort;
    verifier: VideoFrameVerifierPort;
  }>,
): Promise<PrepareVideoEvidenceResult> {
  const metadata = VideoUploadMetadataSchema.safeParse(untrustedMetadata);
  if (!metadata.success || metadata.data.byteLength !== bytes.byteLength) {
    return { ok: false, code: "VIDEO_INPUT_INVALID" };
  }
  if (!hasMp4FileSignature(bytes)) return { ok: false, code: "VIDEO_MP4_SIGNATURE_INVALID" };

  const readiness = await dependencies.runtime.check();
  if (!readiness.ready) {
    return {
      ok: false,
      code:
        readiness.reason === "unavailable"
          ? "VIDEO_RUNTIME_UNAVAILABLE"
          : "VIDEO_RUNTIME_UNVERIFIED",
    };
  }

  let inspectionResult: unknown;
  try {
    inspectionResult = await dependencies.probe.inspect(bytes);
  } catch {
    return { ok: false, code: "VIDEO_PROBE_FAILED" };
  }
  const inspection = validateVideoInspection(inspectionResult);
  if (!inspection.ok) return inspection;
  const plan = createDeterministicFramePlan(inspection.value.durationMs);

  let extracted: unknown;
  try {
    extracted = await dependencies.extractor.extract({
      sourceBytes: bytes,
      inspection: inspection.value,
      plan,
    });
  } catch {
    return { ok: false, code: "VIDEO_EXTRACTION_FAILED" };
  }
  if (!Array.isArray(extracted) || extracted.length !== plan.length) {
    return { ok: false, code: "VIDEO_FRAME_CONTRACT_INVALID" };
  }

  const frames: PreparedVideoFrame[] = [];
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    const parsed = ExtractedVideoFrameSchema.safeParse(extracted[index]);
    if (
      item === undefined ||
      !parsed.success ||
      parsed.data.frameNo !== item.frameNo ||
      parsed.data.timestampMs !== item.timestampMs
    ) {
      return { ok: false, code: "VIDEO_FRAME_CONTRACT_INVALID" };
    }
    let verified = false;
    try {
      verified = await dependencies.verifier.verify(parsed.data);
    } catch {
      verified = false;
    }
    if (!verified) return { ok: false, code: "VIDEO_FRAME_CONTRACT_INVALID" };
    frames.push({
      ...parsed.data,
      locator: {
        type: "video",
        artifactId: metadata.data.artifactId,
        timestampMs: item.timestampMs,
        frameNo: item.frameNo,
      },
    });
  }
  return { ok: true, frames, audioAnalyzed: false };
}
