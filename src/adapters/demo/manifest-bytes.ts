import { createHash, timingSafeEqual } from "node:crypto";
import { DEMO_MANIFEST_MAX_BYTES, DemoManifestSchema, type DemoManifest } from "@/domain/demo";
import { DemoManifestVerificationError } from "./errors";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const sidecarDecoder = new TextDecoder("ascii", { fatal: true });
const SHA256_HEX_WITH_OPTIONAL_LF = /^[0-9a-f]{64}\n?$/u;

export interface VerifiedManifestBytes {
  manifest: DemoManifest;
  manifestSha256: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyAndParseManifestBytes(
  manifestBytes: Uint8Array,
  sidecarBytes: Uint8Array,
): VerifiedManifestBytes {
  if (manifestBytes.byteLength > DEMO_MANIFEST_MAX_BYTES) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_TOO_LARGE");
  }

  let sidecar: string;
  try {
    sidecar = sidecarDecoder.decode(sidecarBytes);
  } catch {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_SEAL_INVALID");
  }
  if (!SHA256_HEX_WITH_OPTIONAL_LF.test(sidecar)) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_SEAL_INVALID");
  }

  const expectedHash = sidecar.endsWith("\n") ? sidecar.slice(0, -1) : sidecar;
  const actualHash = sha256Hex(manifestBytes);
  if (!timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(actualHash, "hex"))) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_SEAL_MISMATCH");
  }

  if (
    manifestBytes.byteLength >= 3 &&
    manifestBytes[0] === 0xef &&
    manifestBytes[1] === 0xbb &&
    manifestBytes[2] === 0xbf
  ) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_INVALID_UTF8");
  }

  let json: string;
  try {
    json = utf8Decoder.decode(manifestBytes);
  } catch {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_INVALID_UTF8");
  }

  let unknownManifest: unknown;
  try {
    unknownManifest = JSON.parse(json) as unknown;
  } catch {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_INVALID_JSON");
  }

  const result = DemoManifestSchema.safeParse(unknownManifest);
  if (!result.success) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_SCHEMA_INVALID");
  }

  return { manifest: result.data, manifestSha256: actualHash };
}
