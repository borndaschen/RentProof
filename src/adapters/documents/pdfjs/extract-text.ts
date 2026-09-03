import type { PdfActiveContentInspection, PdfJsDocument, PdfJsEngine } from "./engine";
import { PdfJsEngineLoadError, PdfTextExtractionError } from "./errors";
import {
  buildExtractedPage,
  extractedCharacterCount,
  type ExtractedPdfPage,
} from "./text-normalization";

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 30;
export const MAX_EXTRACTED_TEXT_CHARACTERS = 300_000;
export const DEFAULT_PDF_PARSE_TIMEOUT_MS = 15_000;

export interface ExtractedPdfText {
  pageCount: number;
  characterCount: number;
  pages: ExtractedPdfPage[];
}

function assertPdfHeader(bytes: Uint8Array): void {
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value)) {
    throw new PdfTextExtractionError("PDF_INVALID_HEADER");
  }
}

function assertNoActiveContent(inspection: PdfActiveContentInspection): void {
  if (inspection.hasJavaScriptOrAction) {
    throw new PdfTextExtractionError("PDF_ACTIVE_CONTENT_DISALLOWED");
  }
  if (inspection.hasAttachments) {
    throw new PdfTextExtractionError("PDF_ATTACHMENTS_DISALLOWED");
  }
  if (inspection.hasForms) {
    throw new PdfTextExtractionError("PDF_FORMS_ACTIONS_DISALLOWED");
  }
  if (inspection.hasExternalLinks) {
    throw new PdfTextExtractionError("PDF_EXTERNAL_LINKS_DISALLOWED");
  }
}

function mapEngineError(error: unknown): PdfTextExtractionError {
  if (error instanceof PdfTextExtractionError) return error;
  if (error instanceof PdfJsEngineLoadError) {
    const code =
      error.code === "encrypted"
        ? "PDF_ENCRYPTED"
        : error.code === "damaged"
          ? "PDF_DAMAGED"
          : "PDF_PARSE_FAILED";
    return new PdfTextExtractionError(code, { cause: error });
  }
  return new PdfTextExtractionError("PDF_PARSE_FAILED", { cause: error });
}

interface Deadline {
  run<T>(operation: Promise<T>): Promise<T>;
}

function createDeadline(timeoutMs: number): Deadline {
  const expiresAt = Date.now() + timeoutMs;
  return {
    run: async <T>(operation: Promise<T>): Promise<T> => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) throw new PdfTextExtractionError("PDF_PARSE_TIMEOUT");

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new PdfTextExtractionError("PDF_PARSE_TIMEOUT")),
          remaining,
        );
      });
      try {
        return await Promise.race([operation, timeout]);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }
    },
  };
}

export async function extractTextPdf(options: {
  bytes: Uint8Array;
  engine: PdfJsEngine;
  timeoutMs?: number | undefined;
}): Promise<ExtractedPdfText> {
  if (options.bytes.byteLength > MAX_PDF_BYTES) {
    throw new PdfTextExtractionError("PDF_TOO_LARGE");
  }
  assertPdfHeader(options.bytes);
  const timeoutMs = options.timeoutMs ?? DEFAULT_PDF_PARSE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new PdfTextExtractionError("PDF_PARSE_TIMEOUT");
  }

  const deadline = createDeadline(timeoutMs);
  const session = options.engine.open(options.bytes);
  let document: PdfJsDocument | undefined;
  let primaryError: PdfTextExtractionError | undefined;

  try {
    document = await deadline.run(session.ready);
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new PdfTextExtractionError("PDF_LOCATOR_INSUFFICIENT");
    }
    if (document.numPages > MAX_PDF_PAGES) {
      throw new PdfTextExtractionError("PDF_PAGE_LIMIT_EXCEEDED");
    }
    assertNoActiveContent(await deadline.run(document.inspectActiveContent()));

    const pages: ExtractedPdfPage[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await deadline.run(document.getPage(pageNumber));
      try {
        assertNoActiveContent(await deadline.run(page.inspectActiveContent()));
        const extractedPage = buildExtractedPage(
          pageNumber,
          await deadline.run(page.getTextItems()),
        );
        characterCount += extractedCharacterCount(extractedPage);
        if (characterCount > MAX_EXTRACTED_TEXT_CHARACTERS) {
          throw new PdfTextExtractionError("PDF_TEXT_LIMIT_EXCEEDED");
        }
        pages.push(extractedPage);
      } finally {
        try {
          await page.cleanup();
        } catch (cleanupError: unknown) {
          throw new PdfTextExtractionError("PDF_RESOURCE_CLEANUP_FAILED", {
            cause: cleanupError,
          });
        }
      }
    }

    if (characterCount === 0 || pages.every((page) => page.segments.length === 0)) {
      throw new PdfTextExtractionError("PDF_LOCATOR_INSUFFICIENT");
    }
    return { pageCount: document.numPages, characterCount, pages };
  } catch (error: unknown) {
    primaryError = mapEngineError(error);
    throw primaryError;
  } finally {
    let cleanupError: unknown;
    try {
      if (document !== undefined) await document.cleanup();
    } catch (error: unknown) {
      cleanupError = error;
    }
    try {
      await session.destroy();
    } catch (error: unknown) {
      cleanupError ??= error;
    }
    if (cleanupError !== undefined) {
      throw new PdfTextExtractionError("PDF_RESOURCE_CLEANUP_FAILED", {
        cause: primaryError ?? cleanupError,
      });
    }
  }
}
