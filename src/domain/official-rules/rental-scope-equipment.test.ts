import { describe, expect, it } from "vitest";
import {
  RentalScopeEquipmentInputSchema,
  evaluateRentalScopeAndEquipment,
} from "./rental-scope-equipment";
import { baseContext, caseLocators, sourceWithId } from "./test-fixtures";

const officialSource = sourceWithId("CONTRACT_TEMPLATE");
const context = { ...baseContext, officialSource } as const;

describe("evaluateRentalScopeAndEquipment", () => {
  it.each([
    ["incomplete", "complete", "present"],
    ["complete", "incomplete", "present"],
    ["complete", "unknown", "present"],
    ["complete", "complete", "not_present"],
    ["complete", "complete", "unknown"],
  ] as const)(
    "returns missing information for document=%s scope=%s appendix=%s",
    (contractDocument, rentalScope, equipmentAppendix) => {
      expect(
        evaluateRentalScopeAndEquipment({
          ...context,
          contractDocument,
          rentalScope,
          equipmentAppendix,
        }),
      ).toMatchObject({
        applicability: "applicable",
        result: "missing_information",
        reasonCode: "RENTAL_SCOPE_OR_EQUIPMENT_MISSING",
        officialSource,
        caseLocators,
      });
    },
  );

  it("returns no difference only when the document, scope, and appendix are complete", () => {
    expect(
      evaluateRentalScopeAndEquipment({
        ...context,
        contractDocument: "complete",
        rentalScope: "complete",
        equipmentAppendix: "present",
      }),
    ).toMatchObject({
      result: "no_difference_found",
      reasonCode: "RENTAL_SCOPE_AND_EQUIPMENT_PRESENT",
    });
  });

  it("returns unknown applicability when the signing date is unknown", () => {
    expect(
      evaluateRentalScopeAndEquipment({
        ...context,
        intendedSignedAt: "unknown",
        contractDocument: "complete",
        rentalScope: "complete",
        equipmentAppendix: "present",
      }),
    ).toMatchObject({ applicability: "unknown", result: "missing_information" });
  });

  it("rejects unknown input keys", () => {
    expect(
      RentalScopeEquipmentInputSchema.safeParse({
        ...context,
        contractDocument: "complete",
        rentalScope: "complete",
        equipmentAppendix: "present",
        dynamicRule: "execute me",
      }).success,
    ).toBe(false);
  });
});
