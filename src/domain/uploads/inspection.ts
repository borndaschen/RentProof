import { UPLOAD_LIMITS } from "./constants";
import type { UploadFailure } from "./errors";
import { ImageInspectionSchema, PdfInspectionSchema } from "./schemas";

export type InspectionSuccess<T> = { ok: true; value: T };

export function validateImageInspection(
  untrustedInspection: unknown,
): InspectionSuccess<ReturnType<typeof ImageInspectionSchema.parse>> | UploadFailure {
  const parsed = ImageInspectionSchema.safeParse(untrustedInspection);
  if (!parsed.success) {
    return { ok: false, code: "UPLOAD_IMAGE_METADATA_INVALID" };
  }
  const pixels = parsed.data.width * parsed.data.height;
  if (!Number.isSafeInteger(pixels) || pixels > UPLOAD_LIMITS.imagePixels) {
    return { ok: false, code: "UPLOAD_IMAGE_PIXELS_EXCEEDED" };
  }
  return { ok: true, value: parsed.data };
}

export function validatePdfInspection(
  untrustedInspection: unknown,
): InspectionSuccess<ReturnType<typeof PdfInspectionSchema.parse>> | UploadFailure {
  const parsed = PdfInspectionSchema.safeParse(untrustedInspection);
  if (!parsed.success) {
    return { ok: false, code: "UPLOAD_PDF_METADATA_INVALID" };
  }
  const inspection = parsed.data;
  if (inspection.pageCount > UPLOAD_LIMITS.pdfPages) {
    return { ok: false, code: "UPLOAD_PDF_PAGES_EXCEEDED" };
  }
  if (inspection.extractedTextCharacters > UPLOAD_LIMITS.pdfExtractedTextCharacters) {
    return { ok: false, code: "UPLOAD_PDF_TEXT_TOO_LARGE" };
  }
  if (
    inspection.encrypted ||
    inspection.hasJavaScript ||
    inspection.attachmentCount > 0 ||
    inspection.hasFormActions ||
    inspection.hasExternalLinks
  ) {
    return { ok: false, code: "UPLOAD_PDF_ACTIVE_CONTENT" };
  }
  if (!inspection.textLocatorsAvailable || inspection.extractedTextCharacters === 0) {
    return { ok: false, code: "UPLOAD_PDF_TEXT_UNAVAILABLE" };
  }
  return { ok: true, value: inspection };
}
