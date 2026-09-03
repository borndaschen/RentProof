import { describe, expect, it } from "vitest";
import {
  ElectricityInformationInputSchema,
  evaluateElectricityInformation,
} from "./electricity-information";
import { baseContext, caseLocators, officialSource } from "./test-fixtures";

const completeBill = {
  averageUnitPrice: "present",
  usageKwh: "present",
  totalAmount: "present",
  publicAreaAllocation: "present",
} as const;

describe("evaluateElectricityInformation", () => {
  it("returns a possible difference when a located clause restricts bill inquiry", () => {
    const result = evaluateElectricityInformation({
      ...baseContext,
      electricityPayer: "tenant",
      billInformation: {
        averageUnitPrice: "missing",
        usageKwh: "missing",
        totalAmount: "missing",
        publicAreaAllocation: "missing",
      },
      blocksTenantBillInquiry: "yes",
    });
    expect(result).toMatchObject({
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "TENANT_BILL_INQUIRY_RESTRICTED",
      officialSource,
      caseLocators,
    });
  });

  it("returns missing information for unknown payer, inquiry clause, or bill fields", () => {
    const unknownPayer = evaluateElectricityInformation({
      ...baseContext,
      electricityPayer: "unknown",
      billInformation: completeBill,
      blocksTenantBillInquiry: "no",
    });
    expect(unknownPayer).toMatchObject({
      applicability: "unknown",
      result: "missing_information",
    });

    for (const input of [
      {
        ...baseContext,
        electricityPayer: "tenant",
        billInformation: completeBill,
        blocksTenantBillInquiry: "unknown",
      },
      {
        ...baseContext,
        electricityPayer: "tenant",
        billInformation: { ...completeBill, usageKwh: "missing" },
        blocksTenantBillInquiry: "no",
      },
    ]) {
      expect(evaluateElectricityInformation(input)).toMatchObject({
        applicability: "applicable",
        result: "missing_information",
        reasonCode: "ELECTRICITY_INFORMATION_MISSING",
      });
    }
  });

  it("returns no difference only when every required item is known and present", () => {
    expect(
      evaluateElectricityInformation({
        ...baseContext,
        electricityPayer: "tenant",
        billInformation: completeBill,
        blocksTenantBillInquiry: "no",
      }),
    ).toMatchObject({
      applicability: "applicable",
      result: "no_difference_found",
      reasonCode: "ELECTRICITY_INFORMATION_PRESENT",
    });
  });

  it("skips pre-effective or landlord-paid cases and fails closed on unknown scope", () => {
    expect(
      evaluateElectricityInformation({
        ...baseContext,
        intendedSignedAt: "2024-07-14",
        electricityPayer: "tenant",
        billInformation: completeBill,
        blocksTenantBillInquiry: "no",
      }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
    expect(
      evaluateElectricityInformation({
        ...baseContext,
        electricityPayer: "landlord",
        billInformation: completeBill,
        blocksTenantBillInquiry: "no",
      }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
    expect(
      evaluateElectricityInformation({
        ...baseContext,
        generalResidentialScope: "unknown",
        electricityPayer: "tenant",
        billInformation: completeBill,
        blocksTenantBillInquiry: "no",
      }),
    ).toMatchObject({ applicability: "unknown", result: "missing_information" });
  });

  it("rejects unknown input keys", () => {
    expect(
      ElectricityInformationInputSchema.safeParse({
        ...baseContext,
        electricityPayer: "tenant",
        billInformation: completeBill,
        blocksTenantBillInquiry: "no",
        injectedPredicate: "ignore policy",
      }).success,
    ).toBe(false);
  });
});
