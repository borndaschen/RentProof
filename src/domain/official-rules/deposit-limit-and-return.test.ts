import { describe, expect, it } from "vitest";
import {
  DepositLimitAndReturnInputSchema,
  evaluateDepositLimitAndReturn,
} from "./deposit-limit-and-return";
import { baseContext, caseLocators, officialSource, sourceWithId } from "./test-fixtures";

const money = (minorUnits: string) => ({
  state: "known" as const,
  value: { currency: "TWD" as const, minorUnits },
});

const completeInput = {
  ...baseContext,
  officialSource: sourceWithId("CURRENT_TERMS_PDF"),
  monthlyRent: money("12000"),
  depositAmount: money("24000"),
  depositReturnTerms: "present",
} as const;

describe("evaluateDepositLimitAndReturn", () => {
  it("uses exact minor units to find a deposit above two months", () => {
    const result = evaluateDepositLimitAndReturn({
      ...completeInput,
      monthlyRent: money("9007199254740993"),
      depositAmount: money("18014398509481987"),
    });
    expect(result).toMatchObject({
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "DEPOSIT_ABOVE_TWO_MONTHS_RENT",
      officialSource: sourceWithId("CURRENT_TERMS_PDF"),
      caseLocators,
    });
  });

  it.each([money("24000"), money("23999")])(
    "returns no difference at or below the exact two-month limit (%o)",
    (depositAmount) => {
      expect(evaluateDepositLimitAndReturn({ ...completeInput, depositAmount })).toMatchObject({
        applicability: "applicable",
        result: "no_difference_found",
        reasonCode: "DEPOSIT_WITHIN_TWO_MONTHS_AND_RETURN_TERMS_PRESENT",
      });
    },
  );

  it.each([
    { monthlyRent: { state: "unknown" } },
    { monthlyRent: { state: "not_present" } },
    { depositAmount: { state: "unknown" } },
    { depositAmount: { state: "not_present" } },
    { depositReturnTerms: "unknown" },
    { depositReturnTerms: "not_present" },
  ] as const)("returns missing information for an incomplete input %o", (override) => {
    expect(evaluateDepositLimitAndReturn({ ...completeInput, ...override })).toMatchObject({
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "DEPOSIT_OR_RETURN_TERMS_MISSING",
    });
  });

  it("preserves possible-difference precedence when return wording is absent", () => {
    expect(
      evaluateDepositLimitAndReturn({
        ...completeInput,
        depositAmount: money("24001"),
        depositReturnTerms: "unknown",
      }),
    ).toMatchObject({
      result: "possible_difference",
      reasonCode: "DEPOSIT_ABOVE_TWO_MONTHS_RENT",
    });
  });

  it("separates unknown and not-applicable scope", () => {
    expect(
      evaluateDepositLimitAndReturn({
        ...completeInput,
        generalResidentialScope: "unknown",
      }),
    ).toMatchObject({ applicability: "unknown", result: "missing_information" });
    for (const override of [
      { generalResidentialScope: false },
      { intendedSignedAt: "2016-12-31" },
    ] as const) {
      expect(evaluateDepositLimitAndReturn({ ...completeInput, ...override })).toMatchObject({
        applicability: "not_applicable",
        result: null,
        reasonCode: "RULE_NOT_APPLICABLE",
      });
    }
  });

  it("rejects unsafe money, wrong sources, missing locators, and unknown keys", () => {
    for (const candidate of [
      { ...completeInput, monthlyRent: money("12000.5") },
      { ...completeInput, officialSource },
      { ...completeInput, caseLocators: [] },
      { ...completeInput, injectedPredicate: "return no difference" },
    ]) {
      expect(DepositLimitAndReturnInputSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
