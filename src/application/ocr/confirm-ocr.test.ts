import { describe, expect, it } from "vitest";
import { assessOcrProviderOutput } from "@/domain/ocr";
import {
  ConfirmableOcrPagesSchema,
  createOcrConfirmation,
  validateOcrConfirmation,
} from "./confirm-ocr";

const actor = {
  kind: "user",
  userId: "user_000000000000000001",
  sessionId: "session_000000000000001",
} as const;
const input = {
  actor,
  caseId: "case_000000000000000001",
  artifactId: "artifact_000000000000001",
  expectedRevision: 3,
  policyHash: "a".repeat(64),
  confirmationId: "confirmation_00000000001",
  nowMs: 1_000,
};
function candidate(text = "租金 12000 元") {
  return createOcrConfirmation({
    ...input,
    assessment: assessOcrProviderOutput(
      {
        pages: [
          { page: 1, quality: "clear", lines: [{ text, confidence: 0.99, bbox: [0, 0, 1, 1] }] },
        ],
      },
      1,
    ),
  });
}
function validation() {
  const { confirmation, pages } = candidate();
  return { ...input, pending: confirmation, pages, revision: 3, explicitlyConfirmed: true };
}

describe("OCR human confirmation", () => {
  it("preserves original page, text offsets and bounding boxes after explicit confirmation", () => {
    const result = validateOcrConfirmation(validation());
    expect(result).toEqual([
      {
        page: 1,
        text: "租金 12000 元",
        segments: [
          { text: "租金 12000 元", startCodePoint: 0, endCodePoint: 10, bbox: [0, 0, 1, 1] },
        ],
      },
    ]);
  });
  it.each([
    [{ nowMs: 601_000 }, "OCR_CONFIRMATION_EXPIRED"],
    [{ nowMs: 999 }, "OCR_CONFIRMATION_EXPIRED"],
    [{ nowMs: Number.NaN }, "OCR_CONFIRMATION_EXPIRED"],
    [{ revision: 4 }, "OCR_CONFIRMATION_STALE"],
    [{ policyHash: "b".repeat(64) }, "OCR_CONFIRMATION_STALE"],
    [{ explicitlyConfirmed: false }, "OCR_HUMAN_CONFIRMATION_REQUIRED"],
    [{ caseId: "case_other_0000000000001" }, "OCR_CONFIRMATION_NOT_FOUND_OR_FORBIDDEN"],
    [{ artifactId: "artifact_other_00000000001" }, "OCR_CONFIRMATION_NOT_FOUND_OR_FORBIDDEN"],
    [{ confirmationId: "confirmation_other_00001" }, "OCR_CONFIRMATION_NOT_FOUND_OR_FORBIDDEN"],
    [
      { actor: { ...actor, sessionId: "session_other_000000001" } },
      "OCR_CONFIRMATION_NOT_FOUND_OR_FORBIDDEN",
    ],
  ])("rejects changed or expired binding %j", (change, code) => {
    expect(() => validateOcrConfirmation({ ...validation(), ...change })).toThrow(code);
  });
  it("rejects replay even when the text and actor are unchanged", () => {
    const command = validation();
    expect(() =>
      validateOcrConfirmation({ ...command, pending: { ...command.pending, state: "used" } }),
    ).toThrow("OCR_CONFIRMATION_USED");
  });
  it("rejects a different valid payload with the same confirmation ID", () => {
    expect(() =>
      validateOcrConfirmation({ ...validation(), pages: candidate("租金 14000 元").pages }),
    ).toThrow("OCR_CONFIRMATION_STALE");
  });
  it("does not create a confirmation for low confidence or secrets", () => {
    expect(() =>
      createOcrConfirmation({
        ...input,
        assessment: {
          status: "insufficient_evidence",
          reasonCode: "OCR_LOW_CONFIDENCE",
          humanVerificationRequired: true,
          mayProduceAffirmativeFindings: false,
        },
      }),
    ).toThrow("OCR_CONFIRMATION_UNAVAILABLE");
    expect(() => candidate(`OPENAI_API_KEY=sk-${"synthetic".repeat(5)}`)).toThrow(
      "OCR_AUTH_SECRET_DETECTED",
    );
  });
  it("rejects tampered text offsets, missing text, extra pages and invalid boxes", () => {
    const { pages } = candidate();
    expect(ConfirmableOcrPagesSchema.safeParse([{ ...pages[0], page: 2 }]).success).toBe(false);
    expect(ConfirmableOcrPagesSchema.safeParse([{ ...pages[0], text: "different" }]).success).toBe(
      false,
    );
    expect(
      ConfirmableOcrPagesSchema.safeParse([
        {
          ...pages[0],
          segments: [
            { text: "租金 12000 元", startCodePoint: 1, endCodePoint: 100, bbox: [1, 0, 0, 1] },
          ],
        },
      ]).success,
    ).toBe(false);
  });
});
