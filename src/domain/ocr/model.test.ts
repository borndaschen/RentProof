import { describe, expect, it } from "vitest";
import { assessOcrProviderOutput } from "./model";

function output(overrides: Record<string, unknown> = {}) {
  return {
    pages: [
      {
        page: 1,
        quality: "clear",
        lines: [{ text: " 租金 12,000 元 ", confidence: 0.99, bbox: [0.1, 0.1, 0.8, 0.2] }],
        ...overrides,
      },
    ],
  };
}

describe("assessOcrProviderOutput", () => {
  it("builds deterministic offsets but always requires human confirmation", () => {
    expect(assessOcrProviderOutput(output(), 1)).toEqual({
      status: "requires_confirmation",
      reasonCode: "OCR_HUMAN_CONFIRMATION_REQUIRED",
      humanVerificationRequired: true,
      mayProduceAffirmativeFindings: false,
      pages: [
        {
          page: 1,
          text: "租金 12,000 元",
          segments: [
            {
              text: "租金 12,000 元",
              startCodePoint: 0,
              endCodePoint: 11,
              bbox: [0.1, 0.1, 0.8, 0.2],
            },
          ],
        },
      ],
    });
  });

  it.each([
    [output({ quality: "unclear" }), "OCR_PAGE_UNCLEAR"],
    [
      output({ lines: [{ text: "模糊", confidence: 0.4, bbox: [0, 0, 1, 1] }] }),
      "OCR_LOW_CONFIDENCE",
    ],
    [output({ lines: [] }), "OCR_EMPTY_DOCUMENT"],
    [{ pages: [{ ...output().pages[0], page: 2 }] }, "OCR_PAGE_SET_INVALID"],
    [{ pages: [{ ...output().pages[0], extra: true }] }, "OCR_PAGE_SET_INVALID"],
  ])("fails closed for unsafe output", (candidate, reasonCode) => {
    expect(assessOcrProviderOutput(candidate, 1)).toMatchObject({
      status: "insufficient_evidence",
      reasonCode,
      mayProduceAffirmativeFindings: false,
    });
  });
});
