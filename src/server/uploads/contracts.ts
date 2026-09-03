import type { DemoManifestFile } from "@/domain/demo";
import type { ExtractedPdfText } from "@/adapters/documents/pdfjs";
import type { UploadErrorCode } from "@/domain/uploads";

export type UploadReceipt = {
  schemaVersion: "rentproof.synthetic-upload-receipt.v1";
  receiptId: string;
  kind: "listing" | "viewing" | "contract" | "follow_up";
  originalSha256: string;
  derivativeSha256: string | null;
  media:
    | { type: "image"; mime: "image/jpeg" | "image/png"; width: number; height: number }
    | { type: "pdf"; mime: "application/pdf"; pageCount: number; characterCount: number };
};

export type PrivateUploadRecord = {
  receipt: UploadReceipt;
  artifactId: string;
  caseId: "golden-v1";
  originalByteLength: number;
  privatePayload:
    { type: "image"; derivativeBytes: Uint8Array } | { type: "pdf"; extracted: ExtractedPdfText };
};

export type SyntheticDemoManifest = {
  caseVersion: string;
  synthetic: boolean;
  manifestHash: string;
  files: readonly DemoManifestFile[];
};

export interface SyntheticDemoManifestSource {
  load(): Promise<SyntheticDemoManifest>;
}

export interface SyntheticImageSanitizer {
  sanitize(
    bytes: Uint8Array,
    mime: "image/jpeg" | "image/png",
  ): Promise<
    | {
        ok: true;
        derivative: {
          bytes: Uint8Array;
          width: number;
          height: number;
          sha256: string;
        };
      }
    | { ok: false; code: string }
  >;
}

export interface SyntheticPdfExtractor {
  extract(bytes: Uint8Array): Promise<ExtractedPdfText>;
}

export type SyntheticUploadErrorCode =
  | "UPLOAD_FIXTURE_ONLY_REQUIRED"
  | "UPLOAD_REAL_DATA_FORBIDDEN"
  | "UPLOAD_CASE_NOT_ALLOWED"
  | "UPLOAD_TRANSPORT_INVALID"
  | "REQUEST_HOST_FORBIDDEN"
  | "REQUEST_ORIGIN_FORBIDDEN"
  | "FORWARDED_HEADER_FORBIDDEN"
  | "UPLOAD_CSRF_REQUIRED"
  | "UPLOAD_RATE_LIMITED"
  | "UPLOAD_CONCURRENT_REQUEST"
  | "UPLOAD_REPLAYED"
  | "DEMO_DIR_MISSING"
  | "DEMO_ARTIFACT_UNAVAILABLE"
  | "DEV_SYNTHETIC_ARTIFACT_NOT_ALLOWLISTED"
  | "DEMO_ARTIFACT_METADATA_MISMATCH"
  | "DEMO_ARTIFACT_TAMPERED"
  | "UPLOAD_IMAGE_PROCESSING_FAILED"
  | "UPLOAD_PDF_PROCESSING_FAILED"
  | UploadErrorCode;

export type SyntheticUploadResult =
  | { ok: true; status: 201; receipt: UploadReceipt }
  | { ok: false; status: number; code: SyntheticUploadErrorCode; retryAfterSeconds?: number };

export type SyntheticUploadTransport = {
  caseId: string;
  sourceIp: string;
  headers: Headers;
  stream: AsyncIterable<unknown>;
};

export type SyntheticUploadProfile = {
  deploymentProfile: "local_development" | "lan_development";
  allowRealData: false;
  llmMode: "fixture" | "live";
  caseVersion: string;
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
};
