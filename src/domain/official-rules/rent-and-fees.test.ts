import { describe, expect, it } from "vitest";
import { RentAndFeesInputSchema, evaluateRentAndFees } from "./rent-and-fees";
import { baseContext, caseLocators, sourceWithId } from "./test-fixtures";

const officialSource = sourceWithId("CURRENT_TERMS_PDF");
const context = { ...baseContext, officialSource } as const;

describe("evaluateRentAndFees", () => {
  it("prioritizes a located unilateral increase clause over other missing fields", () => {
    expect(
      evaluateRentAndFees({
        ...context,
        contractDocument: "incomplete",
        monthlyRent: "unknown",
        fees: "unknown",
        allowsUnilateralRentIncrease: "yes",
      }),
    ).toMatchObject({
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "UNILATERAL_RENT_INCREASE_TEXT",
      officialSource,
      caseLocators,
    });
  });

  it.each([
    ["incomplete", "present", "complete", "no"],
    ["complete", "not_present", "complete", "no"],
    ["complete", "present", "incomplete", "no"],
    ["complete", "present", "complete", "unknown"],
  ] as const)(
    "returns missing information for document=%s rent=%s fees=%s increase=%s",
    (contractDocument, monthlyRent, fees, allowsUnilateralRentIncrease) => {
      expect(
        evaluateRentAndFees({
          ...context,
          contractDocument,
          monthlyRent,
          fees,
          allowsUnilateralRentIncrease,
        }),
      ).toMatchObject({
        result: "missing_information",
        reasonCode: "RENT_OR_FEES_INCOMPLETE",
      });
    },
  );

  it("returns no difference only for complete rent and fee inputs", () => {
    expect(
      evaluateRentAndFees({
        ...context,
        contractDocument: "complete",
        monthlyRent: "present",
        fees: "complete",
        allowsUnilateralRentIncrease: "no",
      }),
    ).toMatchObject({
      result: "no_difference_found",
      reasonCode: "RENT_AND_FEES_COMPLETE",
    });
  });

  it("uses scope/date gates and strict source/input schemas", () => {
    expect(
      evaluateRentAndFees({
        ...context,
        intendedSignedAt: "2020-08-31",
        contractDocument: "complete",
        monthlyRent: "present",
        fees: "complete",
        allowsUnilateralRentIncrease: "yes",
      }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
    expect(
      RentAndFeesInputSchema.safeParse({
        ...context,
        officialSource: sourceWithId("ELECTRICITY_2024"),
        contractDocument: "complete",
        monthlyRent: "present",
        fees: "complete",
        allowsUnilateralRentIncrease: "no",
      }).success,
    ).toBe(false);
    expect(
      RentAndFeesInputSchema.safeParse({
        ...context,
        contractDocument: "complete",
        monthlyRent: "present",
        fees: "complete",
        allowsUnilateralRentIncrease: "no",
        extra: true,
      }).success,
    ).toBe(false);
  });
});
