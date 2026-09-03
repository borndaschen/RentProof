import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  PdfActiveContentInspection,
  PdfJsDocument,
  PdfJsEngine,
  PdfJsLoadingSession,
  PdfJsPage,
} from "./engine";
import { PdfJsEngineLoadError } from "./errors";

interface SizedCollection {
  readonly size: number;
}

export interface PdfJsPageLike {
  getTextContent(options: { includeMarkedContent: false }): Promise<{ items: readonly unknown[] }>;
  getAnnotations(): Promise<unknown>;
  getJSActions(): Promise<SizedCollection | null>;
  cleanup(): unknown;
}

export interface PdfJsDocumentLike {
  readonly numPages: number;
  readonly isPureXfa: boolean;
  getAttachments(): Promise<SizedCollection | null>;
  getJSActions(): Promise<SizedCollection | null>;
  getFieldObjects(): Promise<SizedCollection | null>;
  getOpenAction(): Promise<SizedCollection | null>;
  getOutline(): Promise<unknown>;
  getPage(pageNumber: number): Promise<PdfJsPageLike>;
  cleanup(): Promise<unknown>;
}

export interface PdfJsLoadingTaskLike {
  readonly promise: Promise<PdfJsDocumentLike>;
  destroy(): Promise<void>;
}

export interface PdfJsOpenParameters {
  data: Uint8Array;
  stopAtErrors: true;
  enableXfa: false;
  useSystemFonts: true;
  useWorkerFetch: false;
  disableAutoFetch: true;
  disableStream: true;
}

export type PdfJsLoader = (parameters: PdfJsOpenParameters) => PdfJsLoadingTaskLike;

function nonEmptyMap(value: SizedCollection | null): boolean {
  return value !== null && value.size > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function containsExternalLinkOrAction(values: unknown): boolean {
  if (!Array.isArray(values)) return false;
  const entries: unknown[] = values;
  return entries.some((entry) => {
    if (!isRecord(entry)) return false;
    if (
      typeof entry["url"] === "string" ||
      typeof entry["unsafeUrl"] === "string" ||
      typeof entry["action"] === "string"
    ) {
      return true;
    }
    return containsExternalLinkOrAction(entry["items"]);
  });
}

function mapLoadError(error: unknown): PdfJsEngineLoadError {
  const name = isRecord(error) && typeof error["name"] === "string" ? error["name"] : "";
  if (name === "PasswordException") return new PdfJsEngineLoadError("encrypted", { cause: error });
  if (
    name === "InvalidPDFException" ||
    name === "MissingPDFException" ||
    name === "UnexpectedResponseException"
  ) {
    return new PdfJsEngineLoadError("damaged", { cause: error });
  }
  return new PdfJsEngineLoadError("parse_failed", { cause: error });
}

class RealPdfJsPage implements PdfJsPage {
  readonly #page: PdfJsPageLike;

  constructor(page: PdfJsPageLike) {
    this.#page = page;
  }

  async getTextItems(): Promise<readonly string[]> {
    const content = await this.#page.getTextContent({ includeMarkedContent: false });
    return content.items.flatMap((item) =>
      isRecord(item) && typeof item["str"] === "string" ? [item["str"]] : [],
    );
  }

  async inspectActiveContent(): Promise<PdfActiveContentInspection> {
    const [annotations, javaScriptActions] = await Promise.all([
      this.#page.getAnnotations(),
      this.#page.getJSActions(),
    ]);
    const untrustedAnnotations: unknown[] = Array.isArray(annotations) ? annotations : [];
    return {
      hasJavaScriptOrAction:
        nonEmptyMap(javaScriptActions) ||
        untrustedAnnotations.some(
          (annotation) => isRecord(annotation) && typeof annotation["action"] === "string",
        ),
      hasAttachments: untrustedAnnotations.some(
        (annotation) => isRecord(annotation) && annotation["subtype"] === "FileAttachment",
      ),
      hasForms: untrustedAnnotations.some(
        (annotation) => isRecord(annotation) && annotation["subtype"] === "Widget",
      ),
      hasExternalLinks: containsExternalLinkOrAction(untrustedAnnotations),
    };
  }

  cleanup(): void {
    this.#page.cleanup();
  }
}

class RealPdfJsDocument implements PdfJsDocument {
  readonly #document: PdfJsDocumentLike;

  constructor(document: PdfJsDocumentLike) {
    this.#document = document;
  }

  get numPages(): number {
    return this.#document.numPages;
  }

  async inspectActiveContent(): Promise<PdfActiveContentInspection> {
    const [attachments, javaScriptActions, fields, openAction, outline] = await Promise.all([
      this.#document.getAttachments(),
      this.#document.getJSActions(),
      this.#document.getFieldObjects(),
      this.#document.getOpenAction(),
      this.#document.getOutline(),
    ]);
    return {
      hasJavaScriptOrAction: nonEmptyMap(javaScriptActions) || nonEmptyMap(openAction),
      hasAttachments: nonEmptyMap(attachments),
      hasForms: this.#document.isPureXfa || nonEmptyMap(fields),
      hasExternalLinks: containsExternalLinkOrAction(outline),
    };
  }

  async getPage(pageNumber: number): Promise<PdfJsPage> {
    return new RealPdfJsPage(await this.#document.getPage(pageNumber));
  }

  async cleanup(): Promise<void> {
    await this.#document.cleanup();
  }
}

export function createPdfJsEngine(loader: PdfJsLoader): PdfJsEngine {
  return {
    open(bytes: Uint8Array): PdfJsLoadingSession {
      const loadingTask = loader({
        // Buffer is a Uint8Array subclass whose slice() keeps Buffer identity;
        // PDF.js intentionally rejects Buffer, so always create a plain Uint8Array.
        data: Uint8Array.from(bytes),
        stopAtErrors: true,
        enableXfa: false,
        useSystemFonts: true,
        useWorkerFetch: false,
        disableAutoFetch: true,
        disableStream: true,
      });
      return {
        ready: loadingTask.promise
          .then((document) => new RealPdfJsDocument(document))
          .catch((error: unknown) => {
            throw mapLoadError(error);
          }),
        destroy: async () => loadingTask.destroy(),
      };
    },
  };
}

export const pdfJsEngine = createPdfJsEngine((parameters) =>
  getDocument({
    ...parameters,
  }),
);
