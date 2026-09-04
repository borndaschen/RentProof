import { z } from "zod";

const id = z
  .string()
  .min(20)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const coordinate = z.number().min(0).max(1);

export const ScannedPdfOcrEnvelopeSchema = z
  .object({
    documentType: z.literal("scanned_contract"),
    pages: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(30),
            quality: z.enum(["clear", "unclear"]),
            lines: z
              .array(
                z
                  .object({
                    text: z.string().min(1).max(2_000),
                    confidence: z.number().min(0).max(1),
                    bbox: z
                      .object({
                        xMin: coordinate,
                        yMin: coordinate,
                        xMax: coordinate,
                        yMax: coordinate,
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .max(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export const ScannedPdfOcrInputSchema = z
  .object({
    caseId: id,
    artifactId: id,
    pageCount: z.number().int().min(1).max(30),
    bytes: z
      .custom<Uint8Array>(
        (value) =>
          ArrayBuffer.isView(value) &&
          Object.prototype.toString.call(value) === "[object Uint8Array]",
        "OCR_PDF_BYTES_INVALID",
      )
      .refine((bytes) => bytes.byteLength <= 15 * 1024 * 1024, "OCR_PDF_TOO_LARGE"),
  })
  .strict();

export type ScannedPdfOcrInput = z.infer<typeof ScannedPdfOcrInputSchema>;
export type ScannedPdfOcrEnvelope = z.infer<typeof ScannedPdfOcrEnvelopeSchema>;

export type OcrProviderReasonCode =
  | "OCR_PROVIDER_AUTH_FAILED"
  | "OCR_PROVIDER_RATE_LIMITED"
  | "OCR_PROVIDER_UNAVAILABLE"
  | "OCR_PROVIDER_REFUSED"
  | "OCR_PROVIDER_INCOMPLETE"
  | "OCR_PROVIDER_SCHEMA_INVALID";

export interface OcrProviderProvenance {
  provider: "openai";
  endpoint: "responses.parse";
  stage: "contract.ocr";
  requestedModel: "gpt-5.6-terra";
  resolvedModel: string;
  reasoningEffort: "medium";
  requestedServiceTier: "default";
  resolvedServiceTier: string | null;
  promptVersion: "contract.ocr.prompt.v1";
  schemaVersion: "rentproof.contract-ocr.v1";
  providerRequestId: string;
  providerAttempts: number;
}

export interface ScannedPdfOcrSuccess {
  output: unknown;
  provenance: OcrProviderProvenance;
}
