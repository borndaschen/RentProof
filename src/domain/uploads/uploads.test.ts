import { describe, expect, it } from "vitest";
import {
  UPLOAD_LIMITS,
  UploadFileMetadataSchema,
  isSafeUploadDisplayFilename,
  validateImageInspection,
  validatePdfInspection,
} from ".";

describe("upload constants and schemas", () => {
  it("centralizes the fixed P0 limits", () => {
    expect(UPLOAD_LIMITS).toEqual({
      filesPerRequest: 1,
      pdfBytes: 15 * 1024 * 1024,
      pdfPages: 30,
      pdfExtractedTextCharacters: 300_000,
      imageBytes: 25 * 1024 * 1024,
      imagePixels: 50_000_000,
      caseOriginalImageBytes: 400 * 1024 * 1024,
    });
    expect(Object.isFrozen(UPLOAD_LIMITS)).toBe(true);
  });

  it.each([
    "../contract.pdf",
    "folder/contract.pdf",
    "folder\\contract.pdf",
    "CON",
    "report.pdf.",
    " report.pdf",
    "report.pdf ",
    "e\u0301.pdf",
  ])("rejects unsafe display filename %s", (filename) => {
    expect(isSafeUploadDisplayFilename(filename)).toBe(false);
  });

  it("uses a strict upload metadata schema", () => {
    expect(
      UploadFileMetadataSchema.safeParse({
        filename: "contract.pdf",
        declaredMime: "application/pdf",
        kind: "contract_pdf",
        maxBytes: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(false);
  });
});

describe("validateImageInspection", () => {
  it("accepts exactly 50 million decoded pixels", () => {
    expect(
      validateImageInspection({
        format: "jpeg",
        width: 10_000,
        height: 5_000,
        pageCount: 1,
        animated: false,
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects a decompression bomb and malformed metadata", () => {
    expect(
      validateImageInspection({
        format: "png",
        width: 10_000,
        height: 5_001,
        pageCount: 1,
        animated: false,
      }),
    ).toEqual({ ok: false, code: "UPLOAD_IMAGE_PIXELS_EXCEEDED" });
    expect(
      validateImageInspection({
        format: "png",
        width: 100,
        height: 100,
        pageCount: 2,
        animated: true,
      }),
    ).toEqual({ ok: false, code: "UPLOAD_IMAGE_METADATA_INVALID" });
  });
});

describe("validatePdfInspection", () => {
  const valid = {
    pageCount: 30,
    extractedTextCharacters: 300_000,
    textLocatorsAvailable: true,
    encrypted: false,
    hasJavaScript: false,
    attachmentCount: 0,
    hasFormActions: false,
    hasExternalLinks: false,
  };

  it("accepts the exact page and text limits", () => {
    expect(validatePdfInspection(valid)).toMatchObject({ ok: true });
  });

  it("rejects page and extracted-text overflow", () => {
    expect(validatePdfInspection({ ...valid, pageCount: 31 })).toEqual({
      ok: false,
      code: "UPLOAD_PDF_PAGES_EXCEEDED",
    });
    expect(validatePdfInspection({ ...valid, extractedTextCharacters: 300_001 })).toEqual({
      ok: false,
      code: "UPLOAD_PDF_TEXT_TOO_LARGE",
    });
  });

  it.each([
    { encrypted: true },
    { hasJavaScript: true },
    { attachmentCount: 1 },
    { hasFormActions: true },
    { hasExternalLinks: true },
  ])("rejects encrypted or active PDF content", (unsafe) => {
    expect(validatePdfInspection({ ...valid, ...unsafe })).toEqual({
      ok: false,
      code: "UPLOAD_PDF_ACTIVE_CONTENT",
    });
  });

  it("rejects missing text or locators and malformed inspection data", () => {
    expect(validatePdfInspection({ ...valid, extractedTextCharacters: 0 })).toEqual({
      ok: false,
      code: "UPLOAD_PDF_TEXT_UNAVAILABLE",
    });
    expect(validatePdfInspection({ ...valid, textLocatorsAvailable: false })).toEqual({
      ok: false,
      code: "UPLOAD_PDF_TEXT_UNAVAILABLE",
    });
    expect(validatePdfInspection({ ...valid, unknown: true })).toEqual({
      ok: false,
      code: "UPLOAD_PDF_METADATA_INVALID",
    });
  });
});
