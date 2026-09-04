import type { ScannedPdfPreflightPort } from "@/application/ocr";
import type { PdfActiveContentInspection, PdfJsDocument, PdfJsEngine } from "./engine";
import { PdfJsEngineLoadError, PdfTextExtractionError } from "./errors";
import { DEFAULT_PDF_PARSE_TIMEOUT_MS, MAX_PDF_BYTES, MAX_PDF_PAGES } from "./extract-text";

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

function createDeadline(timeoutMs: number) {
  const expiresAt = Date.now() + timeoutMs;
  return async <T>(operation: Promise<T>): Promise<T> => {
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
  };
}

export async function inspectScannedPdf(options: {
  bytes: Uint8Array;
  engine: PdfJsEngine;
  timeoutMs?: number | undefined;
}): Promise<{ pageCount: number }> {
  if (options.bytes.byteLength > MAX_PDF_BYTES) {
    throw new PdfTextExtractionError("PDF_TOO_LARGE");
  }
  assertPdfHeader(options.bytes);
  const timeoutMs = options.timeoutMs ?? DEFAULT_PDF_PARSE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new PdfTextExtractionError("PDF_PARSE_TIMEOUT");
  }
  const beforeDeadline = createDeadline(timeoutMs);

  const session = options.engine.open(options.bytes);
  let document: PdfJsDocument | undefined;
  let primaryError: PdfTextExtractionError | undefined;
  try {
    document = await beforeDeadline(session.ready);
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new PdfTextExtractionError("PDF_LOCATOR_INSUFFICIENT");
    }
    if (document.numPages > MAX_PDF_PAGES) {
      throw new PdfTextExtractionError("PDF_PAGE_LIMIT_EXCEEDED");
    }
    assertNoActiveContent(await beforeDeadline(document.inspectActiveContent()));
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await beforeDeadline(document.getPage(pageNumber));
      try {
        assertNoActiveContent(await beforeDeadline(page.inspectActiveContent()));
      } finally {
        await page.cleanup();
      }
    }
    return { pageCount: document.numPages };
  } catch (error: unknown) {
    primaryError = mapEngineError(error);
    throw primaryError;
  } finally {
    try {
      if (document !== undefined) await document.cleanup();
      await session.destroy();
    } catch (cleanupError: unknown) {
      throw new PdfTextExtractionError("PDF_RESOURCE_CLEANUP_FAILED", {
        cause: primaryError ?? cleanupError,
      });
    }
  }
}

export function createScannedPdfPreflightAdapter(engine: PdfJsEngine): ScannedPdfPreflightPort {
  return { inspect: async (bytes) => inspectScannedPdf({ bytes, engine }) };
}
