import { describe, expect, it } from "vitest";
import {
  NonMeteredPublicElectricityInputSchema,
  evaluateNonMeteredAndPublicElectricity,
} from "./non-metered-public-electricity";
import { baseContext, caseLocators, officialSource } from "./test-fixtures";

const money = (minorUnits: string) => ({
  state: "known" as const,
  value: { currency: "TWD" as const, minorUnits },
});
const decimal = (value: string) => ({ state: "known" as const, value });

const completeInput = {
  ...baseContext,
  electricityPayer: "tenant",
  billingMode: "non_metered",
  chargedTotal: money("1800"),
  billTotalAmount: money("1800"),
  billUsageKwh: decimal("320.5"),
  billMatch: "same_property_same_period",
  meterScope: "same_rental_scope",
  extraPublicCharge: "not_charged",
  publicAreaAllocation: "unknown",
} as const;

describe("evaluateNonMeteredAndPublicElectricity", () => {
  it("uses exact minor units to compare the non-metered charge with the bill total", () => {
    const result = evaluateNonMeteredAndPublicElectricity({
      ...completeInput,
      chargedTotal: money("9007199254740993"),
      billTotalAmount: money("9007199254740992"),
    });
    expect(result).toMatchObject({
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "NON_METERED_CHARGE_ABOVE_BILL_TOTAL",
      officialSource,
      caseLocators,
    });
  });

  it.each([money("1800"), money("1799")])(
    "returns no difference for an equal or lower non-metered total (%o)",
    (chargedTotal) => {
      expect(
        evaluateNonMeteredAndPublicElectricity({ ...completeInput, chargedTotal }),
      ).toMatchObject({
        result: "no_difference_found",
        reasonCode: "NON_METERED_AND_PUBLIC_ELECTRICITY_NO_DIFFERENCE",
      });
    },
  );

  it("checks a located public-electricity charge independently of per-kWh billing", () => {
    expect(
      evaluateNonMeteredAndPublicElectricity({
        ...completeInput,
        billingMode: "per_kwh",
        chargedTotal: { state: "not_present" },
        extraPublicCharge: "charged",
        publicAreaAllocation: "not_in_bill",
      }),
    ).toMatchObject({
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "PUBLIC_ELECTRICITY_CHARGED_OUTSIDE_BILL",
    });
    expect(
      evaluateNonMeteredAndPublicElectricity({
        ...completeInput,
        billingMode: "included",
        chargedTotal: { state: "not_present" },
        extraPublicCharge: "charged",
        publicAreaAllocation: "included_in_bill",
      }),
    ).toMatchObject({
      result: "no_difference_found",
      reasonCode: "NON_METERED_AND_PUBLIC_ELECTRICITY_NO_DIFFERENCE",
    });
  });

  it.each([
    { billMatch: "mismatch" },
    { billMatch: "unknown" },
    { meterScope: "mismatch" },
    { meterScope: "unknown" },
    { billUsageKwh: { state: "not_present" } },
    { billUsageKwh: { state: "unknown" } },
    { billTotalAmount: { state: "not_present" } },
    { billTotalAmount: { state: "unknown" } },
    { chargedTotal: { state: "not_present" } },
    { chargedTotal: { state: "unknown" } },
    { extraPublicCharge: "unknown" },
    { extraPublicCharge: "charged", publicAreaAllocation: "unknown" },
  ] as const)("returns missing information for incomplete bill evidence %o", (override) => {
    expect(evaluateNonMeteredAndPublicElectricity({ ...completeInput, ...override })).toMatchObject(
      {
        applicability: "applicable",
        result: "missing_information",
        reasonCode: "NON_METERED_OR_PUBLIC_ELECTRICITY_INFORMATION_MISSING",
      },
    );
  });

  it("requires same-period bill, usage, and scope before a possible difference", () => {
    expect(
      evaluateNonMeteredAndPublicElectricity({
        ...completeInput,
        chargedTotal: money("1801"),
        billUsageKwh: { state: "unknown" },
      }),
    ).toMatchObject({
      result: "missing_information",
      reasonCode: "NON_METERED_OR_PUBLIC_ELECTRICITY_INFORMATION_MISSING",
    });
  });

  it("separates unknown applicability from non-applicability", () => {
    for (const override of [
      { electricityPayer: "unknown" },
      { billingMode: "unknown" },
      { billingMode: "per_kwh", extraPublicCharge: "unknown" },
      { generalResidentialScope: "unknown" },
    ] as const) {
      expect(
        evaluateNonMeteredAndPublicElectricity({ ...completeInput, ...override }),
      ).toMatchObject({ applicability: "unknown", result: "missing_information" });
    }
    for (const override of [
      { electricityPayer: "landlord" },
      { billingMode: "per_kwh", extraPublicCharge: "not_charged" },
      { billingMode: "included", extraPublicCharge: "not_charged" },
      { intendedSignedAt: "2024-07-14" },
    ] as const) {
      expect(
        evaluateNonMeteredAndPublicElectricity({ ...completeInput, ...override }),
      ).toMatchObject({ applicability: "not_applicable", result: null });
    }
  });

  it("rejects non-canonical values, wrong sources, missing locators, and unknown keys", () => {
    for (const candidate of [
      { ...completeInput, billUsageKwh: decimal("320.50") },
      {
        ...completeInput,
        billTotalAmount: {
          state: "known",
          value: { currency: "USD", minorUnits: "1800" },
        },
      },
      {
        ...completeInput,
        officialSource: { ...officialSource, sourceId: "CURRENT_TERMS_PDF" },
      },
      { ...completeInput, caseLocators: [] },
      { ...completeInput, predicate: "ignore source" },
    ]) {
      expect(NonMeteredPublicElectricityInputSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
