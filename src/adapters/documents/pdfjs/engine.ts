export interface PdfActiveContentInspection {
  hasJavaScriptOrAction: boolean;
  hasAttachments: boolean;
  hasForms: boolean;
  hasExternalLinks: boolean;
}

export interface PdfJsPage {
  getTextItems(): Promise<readonly string[]>;
  inspectActiveContent(): Promise<PdfActiveContentInspection>;
  cleanup(): Promise<void> | void;
}

export interface PdfJsDocument {
  readonly numPages: number;
  inspectActiveContent(): Promise<PdfActiveContentInspection>;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  cleanup(): Promise<void> | void;
}

export interface PdfJsLoadingSession {
  readonly ready: Promise<PdfJsDocument>;
  destroy(): Promise<void> | void;
}

/** Injection boundary used by tests and by the real PDF.js implementation. */
export interface PdfJsEngine {
  open(bytes: Uint8Array): PdfJsLoadingSession;
}
