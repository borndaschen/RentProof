import { PdfTextExtractionError } from "./errors";

export interface PdfTextLocator {
  page: number;
  textRange: {
    startCodePoint: number;
    endCodePoint: number;
  };
  excerpt: string;
}

export interface PdfTextSegment {
  text: string;
  locator: PdfTextLocator;
}

export interface ExtractedPdfPage {
  page: number;
  text: string;
  segments: PdfTextSegment[];
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function normalizePdfTextItem(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function buildExtractedPage(page: number, rawItems: readonly string[]): ExtractedPdfPage {
  if (!Number.isInteger(page) || page < 1) {
    throw new PdfTextExtractionError("PDF_LOCATOR_INSUFFICIENT");
  }

  const items = rawItems.map(normalizePdfTextItem).filter((item) => item.length > 0);
  const segments: PdfTextSegment[] = [];
  let pageText = "";
  let nextCodePoint = 0;

  for (const item of items) {
    if (pageText.length > 0) {
      pageText += " ";
      nextCodePoint += 1;
    }
    const startCodePoint = nextCodePoint;
    pageText += item;
    nextCodePoint += codePointLength(item);
    segments.push({
      text: item,
      locator: {
        page,
        textRange: { startCodePoint, endCodePoint: nextCodePoint },
        excerpt: Array.from(item).slice(0, 200).join(""),
      },
    });
  }

  return { page, text: pageText, segments };
}

export function extractedCharacterCount(page: ExtractedPdfPage): number {
  return codePointLength(page.text);
}
