import type { OcrAssessment } from "@/domain/ocr";

export interface ScannedPdfPreflightPort {
  inspect(bytes: Uint8Array): Promise<{ pageCount: number }>;
}

export interface OcrExecutionProvenance {
  stage: "contract.ocr";
  provider: string;
  requestedModel: string;
  resolvedModel: string;
  promptVersion: string;
  schemaVersion: string;
  providerAttempts: number;
}

export interface ScannedPdfOcrPort {
  recognize(input: {
    caseId: string;
    artifactId: string;
    bytes: Uint8Array;
    pageCount: number;
  }): Promise<{ output: unknown; provenance: OcrExecutionProvenance }>;
}

export interface PrepareScannedPdfOcrInput {
  caseId: string;
  artifactId: string;
  bytes: Uint8Array;
}

export interface PrepareScannedPdfOcrResult {
  pageCount: number;
  assessment: OcrAssessment;
  provenance: OcrExecutionProvenance;
}
