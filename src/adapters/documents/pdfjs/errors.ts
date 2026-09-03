export type PdfTextExtractionErrorCode =
  | "PDF_TOO_LARGE"
  | "PDF_INVALID_HEADER"
  | "PDF_ENCRYPTED"
  | "PDF_DAMAGED"
  | "PDF_PAGE_LIMIT_EXCEEDED"
  | "PDF_TEXT_LIMIT_EXCEEDED"
  | "PDF_ACTIVE_CONTENT_DISALLOWED"
  | "PDF_ATTACHMENTS_DISALLOWED"
  | "PDF_FORMS_ACTIONS_DISALLOWED"
  | "PDF_EXTERNAL_LINKS_DISALLOWED"
  | "PDF_LOCATOR_INSUFFICIENT"
  | "PDF_PARSE_FAILED"
  | "PDF_PARSE_TIMEOUT"
  | "PDF_RESOURCE_CLEANUP_FAILED";

export class PdfTextExtractionError extends Error {
  readonly code: PdfTextExtractionErrorCode;

  constructor(code: PdfTextExtractionErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "PdfTextExtractionError";
    this.code = code;
  }
}

export type PdfJsEngineLoadErrorCode = "encrypted" | "damaged" | "parse_failed";

export class PdfJsEngineLoadError extends Error {
  readonly code: PdfJsEngineLoadErrorCode;

  constructor(code: PdfJsEngineLoadErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "PdfJsEngineLoadError";
    this.code = code;
  }
}
