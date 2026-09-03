import { describe, expect, it } from "vitest";
import {
  ReviewPeriodInputSchema,
  daysBetweenCalendarDates,
  evaluateReviewPeriod,
} from "./review-period";
import { baseContext, caseLocators, sourceWithId } from "./test-fixtures";

const officialSource = sourceWithId("CURRENT_TERMS_PDF");
const context = { ...baseContext, officialSource } as const;
const completeNoWaiver = {
  ...context,
  contractDocument: "complete",
  reviewWaiverText: "not_present",
} as const;

describe("evaluateReviewPeriod", () => {
  it("flags explicit review periods shorter than three calendar days", () => {
    for (const value of [0, 1, 2]) {
      expect(
        evaluateReviewPeriod({
          ...completeNoWaiver,
          explicitReviewDays: { state: "known", value },
          contractDeliveredAt: { state: "not_present" },
        }),
      ).toMatchObject({
        applicability: "applicable",
        result: "possible_difference",
        reasonCode: "REVIEW_PERIOD_UNDER_THREE_DAYS",
        officialSource,
        caseLocators,
      });
    }
  });

  it("derives calendar days from delivery and intended signing dates", () => {
    expect(daysBetweenCalendarDates("2024-02-28", "2024-03-02")).toBe(3);
    expect(
      evaluateReviewPeriod({
        ...completeNoWaiver,
        intendedSignedAt: "2026-09-03",
        explicitReviewDays: { state: "not_present" },
        contractDeliveredAt: { state: "known", value: "2026-09-01" },
      }),
    ).toMatchObject({
      result: "possible_difference",
      reasonCode: "REVIEW_PERIOD_UNDER_THREE_DAYS",
    });
  });

  it("flags located waiver language, including semantic paraphrase candidates", () => {
    for (const excerpt of [
      "承租人同意不主張三日以上之契約審閱期間",
      "雙方確認簽約前無須另行攜回審閱",
    ]) {
      expect(
        evaluateReviewPeriod({
          ...context,
          caseLocators: [
            { kind: "case_field", field: "case.general_residential_scope" },
            { kind: "contract_text", artifactId: "contract-1", page: 1, excerpt },
          ],
          contractDocument: "incomplete",
          explicitReviewDays: { state: "unknown" },
          contractDeliveredAt: { state: "unknown" },
          reviewWaiverText: "present",
        }),
      ).toMatchObject({
        result: "possible_difference",
        reasonCode: "REVIEW_PERIOD_WAIVER_TEXT",
      });
    }
  });

  it("requires a contract-text locator for a positive waiver candidate", () => {
    expect(
      ReviewPeriodInputSchema.safeParse({
        ...context,
        caseLocators: [{ kind: "case_field", field: "contract.review_waiver_text" }],
        contractDocument: "complete",
        explicitReviewDays: { state: "known", value: 3 },
        contractDeliveredAt: { state: "not_present" },
        reviewWaiverText: "present",
      }).success,
    ).toBe(false);
  });

  it("returns missing information when no conclusive duration or waiver state exists", () => {
    for (const input of [
      {
        ...completeNoWaiver,
        explicitReviewDays: { state: "not_present" },
        contractDeliveredAt: { state: "not_present" },
      },
      {
        ...completeNoWaiver,
        contractDocument: "incomplete",
        explicitReviewDays: { state: "known", value: 3 },
        contractDeliveredAt: { state: "not_present" },
      },
      {
        ...completeNoWaiver,
        reviewWaiverText: "unknown",
        explicitReviewDays: { state: "known", value: 3 },
        contractDeliveredAt: { state: "not_present" },
      },
    ] as const) {
      expect(evaluateReviewPeriod(input)).toMatchObject({
        applicability: "applicable",
        result: "missing_information",
        reasonCode: "REVIEW_PERIOD_INFORMATION_MISSING",
      });
    }
  });

  it("returns no difference only with at least three days, a complete contract and no waiver", () => {
    for (const input of [
      {
        ...completeNoWaiver,
        explicitReviewDays: { state: "known", value: 3 },
        contractDeliveredAt: { state: "unknown" },
      },
      {
        ...completeNoWaiver,
        intendedSignedAt: "2026-09-04",
        explicitReviewDays: { state: "not_present" },
        contractDeliveredAt: { state: "known", value: "2026-09-01" },
      },
    ] as const) {
      expect(evaluateReviewPeriod(input)).toMatchObject({
        result: "no_difference_found",
        reasonCode: "REVIEW_PERIOD_AT_LEAST_THREE_DAYS_NO_WAIVER_FOUND",
      });
    }
  });

  it("applies unknown and not-applicable scope/date gates", () => {
    const fields = {
      contractDocument: "complete",
      explicitReviewDays: { state: "known", value: 2 },
      contractDeliveredAt: { state: "not_present" },
      reviewWaiverText: "not_present",
    } as const;
    expect(
      evaluateReviewPeriod({ ...context, generalResidentialScope: "unknown", ...fields }),
    ).toMatchObject({ applicability: "unknown", result: "missing_information" });
    expect(
      evaluateReviewPeriod({ ...context, intendedSignedAt: "2016-12-31", ...fields }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
    expect(
      evaluateReviewPeriod({ ...context, generalResidentialScope: false, ...fields }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
  });

  it("rejects malformed states, dates, values and unknown keys", () => {
    const valid = {
      ...completeNoWaiver,
      explicitReviewDays: { state: "known", value: 3 },
      contractDeliveredAt: { state: "not_present" },
    } as const;
    for (const input of [
      { ...valid, injectedPredicate: "return passed" },
      { ...valid, explicitReviewDays: { state: "known", value: -1 } },
      { ...valid, explicitReviewDays: { state: "known", value: 2, hidden: true } },
      { ...valid, contractDeliveredAt: { state: "known", value: "09/01/2026" } },
      { ...valid, reviewWaiverText: false },
    ]) {
      expect(ReviewPeriodInputSchema.safeParse(input).success).toBe(false);
    }
  });
});
