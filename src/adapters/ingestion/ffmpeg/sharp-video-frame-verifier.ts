import { createHash } from "node:crypto";
import type { VideoFrameVerifierPort } from "@/application/video";
import type { ExtractedVideoFrame } from "@/domain/video";
import { verifySharpDerivative } from "@/adapters/ingestion/sharp";

export class SharpVideoFrameVerifier implements VideoFrameVerifierPort {
  async verify(frame: ExtractedVideoFrame): Promise<boolean> {
    const verified = await verifySharpDerivative(frame.bytes, "image/jpeg");
    if (!verified.ok || verified.width !== frame.width || verified.height !== frame.height) {
      return false;
    }
    return createHash("sha256").update(frame.bytes).digest("hex") === frame.sha256;
  }
}
