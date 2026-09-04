import { describe, expect, it } from "vitest";
import type { PdfActiveContentInspection, PdfJsEngine } from "./engine";
import { PdfTextExtractionError } from "./errors";
import { inspectScannedPdf } from "./inspect-scanned-pdf";

const clean: PdfActiveContentInspection = {
  hasJavaScriptOrAction: false,
  hasAttachments: false,
  hasForms: false,
  hasExternalLinks: false,
};

function pdfBytes() {
  return new TextEncoder().encode("%PDF-synthetic");
}

function engine(inspection: PdfActiveContentInspection) {
  const state = { pageCleanup: 0, documentCleanup: 0, destroy: 0 };
  const value: PdfJsEngine = {
    open: () => ({
      ready: Promise.resolve({
        numPages: 1,
        inspectActiveContent: async () => inspection,
        getPage: async () => ({
          getTextItems: async () => {
            throw new Error("preflight must not extract text");
          },
          inspectActiveContent: async () => clean,
          cleanup: () => {
            state.pageCleanup += 1;
          },
        }),
        cleanup: () => {
          state.documentCleanup += 1;
        },
      }),
      destroy: () => {
        state.destroy += 1;
      },
    }),
  };
  return { value, state };
}

describe("inspectScannedPdf", () => {
  it("accepts a passive scanned PDF without requiring a text layer", async () => {
    const mock = engine(clean);
    await expect(inspectScannedPdf({ bytes: pdfBytes(), engine: mock.value })).resolves.toEqual({
      pageCount: 1,
    });
    expect(mock.state).toEqual({ pageCleanup: 1, documentCleanup: 1, destroy: 1 });
  });

  it("rejects active content before OCR and still releases resources", async () => {
    const mock = engine({ ...clean, hasJavaScriptOrAction: true });
    await expect(inspectScannedPdf({ bytes: pdfBytes(), engine: mock.value })).rejects.toEqual(
      expect.objectContaining({ code: "PDF_ACTIVE_CONTENT_DISALLOWED" }),
    );
    expect(mock.state.documentCleanup).toBe(1);
    expect(mock.state.destroy).toBe(1);
  });

  it("rejects invalid bytes before opening the engine", async () => {
    const mock = engine(clean);
    await expect(
      inspectScannedPdf({ bytes: new Uint8Array(), engine: mock.value }),
    ).rejects.toBeInstanceOf(PdfTextExtractionError);
    expect(mock.state.destroy).toBe(0);
  });
});
