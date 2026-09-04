import { z } from "zod";

export const OCR_MIN_LINE_CONFIDENCE = 0.9;
export const OCR_MAX_PAGES = 30;
export const OCR_MAX_TEXT_CHARACTERS = 300_000;

const coordinate = z.number().min(0).max(1);

export const OcrBoundingBoxSchema = z
  .tuple([coordinate, coordinate, coordinate, coordinate])
  .superRefine(([xMin, yMin, xMax, yMax], context) => {
    if (xMin >= xMax) context.addIssue({ code: "custom", message: "OCR_BBOX_X_INVALID" });
    if (yMin >= yMax) context.addIssue({ code: "custom", message: "OCR_BBOX_Y_INVALID" });
  });

export const OcrProviderOutputSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(OCR_MAX_PAGES),
            quality: z.enum(["clear", "unclear"]),
            lines: z
              .array(
                z
                  .object({
                    text: z.string().min(1).max(2_000),
                    confidence: z.number().min(0).max(1),
                    bbox: OcrBoundingBoxSchema,
                  })
                  .strict(),
              )
              .max(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(OCR_MAX_PAGES),
  })
  .strict();

export type OcrProviderOutput = z.infer<typeof OcrProviderOutputSchema>;

export type OcrInsufficientReason =
  | "OCR_PAGE_SET_INVALID"
  | "OCR_PAGE_UNCLEAR"
  | "OCR_LOW_CONFIDENCE"
  | "OCR_EMPTY_DOCUMENT"
  | "OCR_TEXT_LIMIT_EXCEEDED";

export type OcrAssessment =
  | {
      status: "insufficient_evidence";
      reasonCode: OcrInsufficientReason;
      humanVerificationRequired: true;
      mayProduceAffirmativeFindings: false;
    }
  | {
      status: "requires_confirmation";
      reasonCode: "OCR_HUMAN_CONFIRMATION_REQUIRED";
      humanVerificationRequired: true;
      mayProduceAffirmativeFindings: false;
      pages: Array<{
        page: number;
        text: string;
        segments: Array<{
          text: string;
          startCodePoint: number;
          endCodePoint: number;
          bbox: [number, number, number, number];
        }>;
      }>;
    };

function codePointLength(value: string): number {
  return [...value].length;
}

function normalizeLine(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function assessOcrProviderOutput(
  untrustedOutput: unknown,
  expectedPageCount: number,
): OcrAssessment {
  const parsed = OcrProviderOutputSchema.safeParse(untrustedOutput);
  if (!parsed.success || !Number.isInteger(expectedPageCount) || expectedPageCount < 1) {
    return insufficient("OCR_PAGE_SET_INVALID");
  }

  const ordered = [...parsed.data.pages].sort((left, right) => left.page - right.page);
  if (
    ordered.length !== expectedPageCount ||
    ordered.some((page, index) => page.page !== index + 1)
  ) {
    return insufficient("OCR_PAGE_SET_INVALID");
  }
  if (ordered.some((page) => page.quality !== "clear")) {
    return insufficient("OCR_PAGE_UNCLEAR");
  }
  if (
    ordered.some((page) => page.lines.some((line) => line.confidence < OCR_MIN_LINE_CONFIDENCE))
  ) {
    return insufficient("OCR_LOW_CONFIDENCE");
  }

  let totalCharacters = 0;
  const pages = ordered.map((page) => {
    let text = "";
    let offset = 0;
    const segments: Array<{
      text: string;
      startCodePoint: number;
      endCodePoint: number;
      bbox: [number, number, number, number];
    }> = [];
    for (const line of page.lines) {
      const normalized = normalizeLine(line.text);
      if (normalized.length === 0) continue;
      if (text.length > 0) {
        text += "\n";
        offset += 1;
      }
      const startCodePoint = offset;
      text += normalized;
      offset += codePointLength(normalized);
      segments.push({
        text: normalized,
        startCodePoint,
        endCodePoint: offset,
        bbox: line.bbox,
      });
    }
    totalCharacters += offset;
    return { page: page.page, text, segments };
  });

  if (totalCharacters === 0) return insufficient("OCR_EMPTY_DOCUMENT");
  if (totalCharacters > OCR_MAX_TEXT_CHARACTERS) {
    return insufficient("OCR_TEXT_LIMIT_EXCEEDED");
  }

  return {
    status: "requires_confirmation",
    reasonCode: "OCR_HUMAN_CONFIRMATION_REQUIRED",
    humanVerificationRequired: true,
    mayProduceAffirmativeFindings: false,
    pages,
  };
}

function insufficient(reasonCode: OcrInsufficientReason): OcrAssessment {
  return {
    status: "insufficient_evidence",
    reasonCode,
    humanVerificationRequired: true,
    mayProduceAffirmativeFindings: false,
  };
}
