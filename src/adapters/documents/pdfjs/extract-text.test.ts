import { describe, expect, it } from "vitest";
import type { PdfActiveContentInspection, PdfJsDocument, PdfJsEngine, PdfJsPage } from "./engine";
import { PdfJsEngineLoadError, PdfTextExtractionError } from "./errors";
import { MAX_PDF_BYTES, extractTextPdf } from "./extract-text";

const cleanInspection: PdfActiveContentInspection = {
  hasJavaScriptOrAction: false,
  hasAttachments: false,
  hasForms: false,
  hasExternalLinks: false,
};

function pdfBytes(size = 16): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-"));
  return bytes;
}

interface MockState {
  pageCleanupCount: number;
  documentCleanupCount: number;
  destroyCount: number;
  openCount: number;
}

interface MockOptions {
  pages?: readonly (readonly string[])[];
  documentInspection?: PdfActiveContentInspection;
  pageInspection?: PdfActiveContentInspection;
  loadError?: unknown;
  ready?: Promise<PdfJsDocument>;
  documentCleanupError?: Error;
  pageCleanupError?: Error;
  destroyError?: Error;
}

function mockEngine(options: MockOptions = {}): { engine: PdfJsEngine; state: MockState } {
  const state: MockState = {
    pageCleanupCount: 0,
    documentCleanupCount: 0,
    destroyCount: 0,
    openCount: 0,
  };
  const pages = options.pages ?? [["Rental contract"]];
  const document: PdfJsDocument = {
    numPages: pages.length,
    inspectActiveContent: async () => options.documentInspection ?? cleanInspection,
    getPage: async (pageNumber): Promise<PdfJsPage> => ({
      getTextItems: async () => pages[pageNumber - 1] ?? [],
      inspectActiveContent: async () => options.pageInspection ?? cleanInspection,
      cleanup: () => {
        state.pageCleanupCount += 1;
        if (options.pageCleanupError !== undefined) throw options.pageCleanupError;
      },
    }),
    cleanup: () => {
      state.documentCleanupCount += 1;
      if (options.documentCleanupError !== undefined) throw options.documentCleanupError;
    },
  };
  const ready =
    options.ready ??
    (options.loadError === undefined
      ? Promise.resolve(document)
      : Promise.reject(options.loadError));
  return {
    state,
    engine: {
      open: () => {
        state.openCount += 1;
        return {
          ready,
          destroy: () => {
            state.destroyCount += 1;
            if (options.destroyError !== undefined) throw options.destroyError;
          },
        };
      },
    },
  };
}

async function expectCode(
  operation: Promise<unknown>,
  code: PdfTextExtractionError["code"],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code });
}

describe("extractTextPdf", () => {
  it("extracts normalized per-page text with page, code-point range, and excerpt locators", async () => {
    const { engine, state } = mockEngine({
      pages: [["  租賃\n契約  ", "🙂設備"], ["第二頁"]],
    });

    const result = await extractTextPdf({ bytes: pdfBytes(), engine });

    expect(result).toEqual({
      pageCount: 2,
      characterCount: 12,
      pages: [
        {
          page: 1,
          text: "租賃 契約 🙂設備",
          segments: [
            {
              text: "租賃 契約",
              locator: {
                page: 1,
                textRange: { startCodePoint: 0, endCodePoint: 5 },
                excerpt: "租賃 契約",
              },
            },
            {
              text: "🙂設備",
              locator: {
                page: 1,
                textRange: { startCodePoint: 6, endCodePoint: 9 },
                excerpt: "🙂設備",
              },
            },
          ],
        },
        {
          page: 2,
          text: "第二頁",
          segments: [
            {
              text: "第二頁",
              locator: {
                page: 2,
                textRange: { startCodePoint: 0, endCodePoint: 3 },
                excerpt: "第二頁",
              },
            },
          ],
        },
      ],
    });
    expect(state).toMatchObject({
      pageCleanupCount: 2,
      documentCleanupCount: 1,
      destroyCount: 1,
      openCount: 1,
    });
  });

  it("rejects byte limits and invalid magic before opening PDF.js", async () => {
    const oversized = mockEngine();
    await expectCode(
      extractTextPdf({ bytes: pdfBytes(MAX_PDF_BYTES + 1), engine: oversized.engine }),
      "PDF_TOO_LARGE",
    );
    expect(oversized.state.openCount).toBe(0);

    const invalid = mockEngine();
    await expectCode(
      extractTextPdf({ bytes: new TextEncoder().encode("not-pdf"), engine: invalid.engine }),
      "PDF_INVALID_HEADER",
    );
    expect(invalid.state.openCount).toBe(0);
  });

  it("rejects more than 30 pages and always destroys the loading session", async () => {
    const { engine, state } = mockEngine({ pages: Array.from({ length: 31 }, () => ["text"]) });
    await expectCode(extractTextPdf({ bytes: pdfBytes(), engine }), "PDF_PAGE_LIMIT_EXCEEDED");
    expect(state.documentCleanupCount).toBe(1);
    expect(state.destroyCount).toBe(1);
  });

  it("rejects invalid page metadata and timeout configuration", async () => {
    const invalidDocument = mockEngine({ pages: [] });
    await expectCode(
      extractTextPdf({ bytes: pdfBytes(), engine: invalidDocument.engine }),
      "PDF_LOCATOR_INSUFFICIENT",
    );
    const invalidTimeout = mockEngine();
    await expectCode(
      extractTextPdf({ bytes: pdfBytes(), engine: invalidTimeout.engine, timeoutMs: 0 }),
      "PDF_PARSE_TIMEOUT",
    );
    expect(invalidTimeout.state.openCount).toBe(0);
  });

  it("rejects normalized text over 300,000 characters without a fallback", async () => {
    const { engine, state } = mockEngine({ pages: [["字".repeat(300_001)]] });
    await expectCode(extractTextPdf({ bytes: pdfBytes(), engine }), "PDF_TEXT_LIMIT_EXCEEDED");
    expect(state.pageCleanupCount).toBe(1);
    expect(state.destroyCount).toBe(1);
  });

  it("rejects documents without locatable text rather than returning unpaged full text", async () => {
    const { engine } = mockEngine({ pages: [[" \n "], []] });
    await expectCode(extractTextPdf({ bytes: pdfBytes(), engine }), "PDF_LOCATOR_INSUFFICIENT");
  });

  it.each([
    [{ hasJavaScriptOrAction: true }, "PDF_ACTIVE_CONTENT_DISALLOWED"],
    [{ hasAttachments: true }, "PDF_ATTACHMENTS_DISALLOWED"],
    [{ hasForms: true }, "PDF_FORMS_ACTIONS_DISALLOWED"],
    [{ hasExternalLinks: true }, "PDF_EXTERNAL_LINKS_DISALLOWED"],
  ] as const)("rejects disallowed document content %o", async (override, code) => {
    const { engine, state } = mockEngine({
      documentInspection: { ...cleanInspection, ...override },
    });
    await expectCode(extractTextPdf({ bytes: pdfBytes(), engine }), code);
    expect(state.pageCleanupCount).toBe(0);
    expect(state.destroyCount).toBe(1);
  });

  it("applies the same active-content checks at page level", async () => {
    const { engine, state } = mockEngine({
      pageInspection: { ...cleanInspection, hasExternalLinks: true },
    });
    await expectCode(
      extractTextPdf({ bytes: pdfBytes(), engine }),
      "PDF_EXTERNAL_LINKS_DISALLOWED",
    );
    expect(state.pageCleanupCount).toBe(1);
  });

  it.each([
    [new PdfJsEngineLoadError("encrypted"), "PDF_ENCRYPTED"],
    [new PdfJsEngineLoadError("damaged"), "PDF_DAMAGED"],
    [new PdfJsEngineLoadError("parse_failed"), "PDF_PARSE_FAILED"],
    [new Error("unexpected"), "PDF_PARSE_FAILED"],
  ] as const)("maps load failure to %s", async (loadError, code) => {
    const { engine, state } = mockEngine({ loadError });
    await expectCode(extractTextPdf({ bytes: pdfBytes(), engine }), code);
    expect(state.destroyCount).toBe(1);
  });

  it("times out a stalled engine and destroys its resources", async () => {
    const never = new Promise<PdfJsDocument>(() => undefined);
    const { engine, state } = mockEngine({ ready: never });
    await expectCode(
      extractTextPdf({ bytes: pdfBytes(), engine, timeoutMs: 5 }),
      "PDF_PARSE_TIMEOUT",
    );
    expect(state.destroyCount).toBe(1);
  });

  it("reports cleanup failure as a typed failure", async () => {
    const { engine, state } = mockEngine({ documentCleanupError: new Error("cleanup") });
    await expectCode(extractTextPdf({ bytes: pdfBytes(), engine }), "PDF_RESOURCE_CLEANUP_FAILED");
    expect(state.documentCleanupCount).toBe(1);

    const pageFailure = mockEngine({ pageCleanupError: new Error("page cleanup") });
    await expectCode(
      extractTextPdf({ bytes: pdfBytes(), engine: pageFailure.engine }),
      "PDF_RESOURCE_CLEANUP_FAILED",
    );
    expect(pageFailure.state.destroyCount).toBe(1);

    const destroyFailure = mockEngine({ destroyError: new Error("destroy") });
    await expectCode(
      extractTextPdf({ bytes: pdfBytes(), engine: destroyFailure.engine }),
      "PDF_RESOURCE_CLEANUP_FAILED",
    );
  });
});
