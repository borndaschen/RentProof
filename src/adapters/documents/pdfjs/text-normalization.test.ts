import { describe, expect, it } from "vitest";
import { PdfTextExtractionError } from "./errors";
import {
  buildExtractedPage,
  extractedCharacterCount,
  normalizePdfTextItem,
} from "./text-normalization";

describe("PDF text normalization", () => {
  it("normalizes NFC and whitespace without losing page boundaries", () => {
    expect(normalizePdfTextItem("  e\u0301\n\ttext  ")).toBe("é text");
    const page = buildExtractedPage(2, ["first", "second"]);
    expect(page.page).toBe(2);
    expect(page.text).toBe("first second");
    expect(extractedCharacterCount(page)).toBe(12);
  });

  it("limits excerpts while preserving the full segment range", () => {
    const page = buildExtractedPage(1, ["字".repeat(205)]);
    expect(page.segments[0]?.locator.excerpt).toHaveLength(200);
    expect(page.segments[0]?.locator.textRange).toEqual({
      startCodePoint: 0,
      endCodePoint: 205,
    });
  });

  it("rejects invalid page locators", () => {
    for (const page of [0, -1, 1.5]) {
      expect(() => buildExtractedPage(page, ["text"])).toThrowError(
        new PdfTextExtractionError("PDF_LOCATOR_INSUFFICIENT"),
      );
    }
  });
});
