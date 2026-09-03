import { describe, expect, it } from "vitest";
import {
  PerKwhElectricityInputSchema,
  compareDecimalStrings,
  evaluatePerKwhElectricity,
} from "./per-kwh-electricity";
import { baseContext, caseLocators, officialSource } from "./test-fixtures";

const known = (value: string) => ({ state: "known", value }) as const;
const completeInput = {
  ...baseContext,
  electricityPayer: "tenant",
  billingMode: "per_kwh",
  chargedRate: known("5"),
  billAverageUnitPrice: known("4.75"),
  billMatch: "same_property_same_period",
} as const;

describe("compareDecimalStrings", () => {
  it("compares exact decimals beyond Number safe integer precision", () => {
    expect(compareDecimalStrings("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareDecimalStrings("5", "5.25")).toBe(-1);
    expect(compareDecimalStrings("5.25", "5.25")).toBe(0);
  });
});

describe("evaluatePerKwhElectricity", () => {
  it("returns a possible difference only with same-property same-period comparable evidence", () => {
    expect(evaluatePerKwhElectricity(completeInput)).toMatchObject({
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "ELECTRICITY_RATE_ABOVE_BILL_AVERAGE",
      officialSource,
      caseLocators,
    });
  });

  it("returns no difference for an equal or lower exact rate", () => {
    for (const chargedRate of [known("4.75"), known("4.5")]) {
      expect(evaluatePerKwhElectricity({ ...completeInput, chargedRate })).toMatchObject({
        result: "no_difference_found",
        reasonCode: "ELECTRICITY_RATE_NOT_ABOVE_BILL_AVERAGE",
      });
    }
  });

  it.each([
    [{ billMatch: "mismatch" }, "SAME_PROPERTY_PERIOD_BILL_MISSING"],
    [{ billMatch: "unknown" }, "SAME_PROPERTY_PERIOD_BILL_MISSING"],
    [{ chargedRate: { state: "not_present" } }, "SAME_PROPERTY_PERIOD_BILL_MISSING"],
    [{ billAverageUnitPrice: { state: "unknown" } }, "SAME_PROPERTY_PERIOD_BILL_MISSING"],
  ] as const)(
    "returns missing information for incomplete comparison %o",
    (override, reasonCode) => {
      expect(evaluatePerKwhElectricity({ ...completeInput, ...override })).toMatchObject({
        applicability: "applicable",
        result: "missing_information",
        reasonCode,
      });
    },
  );

  it("separates not-applicable and unknown applicability", () => {
    for (const override of [
      { electricityPayer: "landlord" },
      { billingMode: "non_metered" },
      { billingMode: "included" },
      { intendedSignedAt: "2024-07-14" },
    ] as const) {
      expect(evaluatePerKwhElectricity({ ...completeInput, ...override })).toMatchObject({
        applicability: "not_applicable",
        result: null,
      });
    }
    for (const override of [{ electricityPayer: "unknown" }, { billingMode: "unknown" }] as const) {
      expect(evaluatePerKwhElectricity({ ...completeInput, ...override })).toMatchObject({
        applicability: "unknown",
        result: "missing_information",
      });
    }
  });

  it("rejects non-canonical decimals, wrong source, and unknown keys", () => {
    expect(
      PerKwhElectricityInputSchema.safeParse({
        ...completeInput,
        chargedRate: known("5.00"),
      }).success,
    ).toBe(false);
    expect(
      PerKwhElectricityInputSchema.safeParse({
        ...completeInput,
        officialSource: sourceWithWrongId(),
      }).success,
    ).toBe(false);
    expect(PerKwhElectricityInputSchema.safeParse({ ...completeInput, extra: true }).success).toBe(
      false,
    );
  });
});

function sourceWithWrongId() {
  return { ...officialSource, sourceId: "CURRENT_TERMS_PDF" };
}
