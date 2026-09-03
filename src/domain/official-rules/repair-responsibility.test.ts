import { describe, expect, it } from "vitest";
import {
  RepairResponsibilityInputSchema,
  evaluateRepairResponsibility,
} from "./repair-responsibility";
import { baseContext, caseLocators, sourceWithId } from "./test-fixtures";

const officialSource = sourceWithId("CURRENT_TERMS_PDF");
const context = { ...baseContext, officialSource } as const;

describe("evaluateRepairResponsibility", () => {
  it("prioritizes a located all-repairs assignment over incomplete supporting fields", () => {
    expect(
      evaluateRepairResponsibility({
        ...context,
        tenantRepairItems: "unknown",
        repairContact: "unknown",
        assignsAllRepairsWithoutItemization: "yes",
      }),
    ).toMatchObject({
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "REPAIRS_ASSIGNED_WITHOUT_ITEMIZATION",
      officialSource,
      caseLocators,
    });
  });

  it.each([
    ["incomplete", "present", "no"],
    ["unknown", "present", "no"],
    ["complete", "not_present", "no"],
    ["complete", "unknown", "no"],
    ["complete", "present", "unknown"],
  ] as const)(
    "returns missing information for items=%s contact=%s assignment=%s",
    (tenantRepairItems, repairContact, assignsAllRepairsWithoutItemization) => {
      expect(
        evaluateRepairResponsibility({
          ...context,
          tenantRepairItems,
          repairContact,
          assignsAllRepairsWithoutItemization,
        }),
      ).toMatchObject({
        result: "missing_information",
        reasonCode: "REPAIR_SCOPE_OR_CONTACT_MISSING",
      });
    },
  );

  it("returns no difference only when repair scope and contact are complete", () => {
    expect(
      evaluateRepairResponsibility({
        ...context,
        tenantRepairItems: "complete",
        repairContact: "present",
        assignsAllRepairsWithoutItemization: "no",
      }),
    ).toMatchObject({
      result: "no_difference_found",
      reasonCode: "REPAIR_SCOPE_AND_CONTACT_PRESENT",
    });
  });

  it("uses scope/date gates and strict input/source schemas", () => {
    expect(
      evaluateRepairResponsibility({
        ...context,
        generalResidentialScope: false,
        tenantRepairItems: "complete",
        repairContact: "present",
        assignsAllRepairsWithoutItemization: "yes",
      }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
    expect(
      RepairResponsibilityInputSchema.safeParse({
        ...context,
        officialSource: sourceWithId("ELECTRICITY_2024"),
        tenantRepairItems: "complete",
        repairContact: "present",
        assignsAllRepairsWithoutItemization: "no",
      }).success,
    ).toBe(false);
    expect(
      RepairResponsibilityInputSchema.safeParse({
        ...context,
        tenantRepairItems: "complete",
        repairContact: "present",
        assignsAllRepairsWithoutItemization: "no",
        unknown: true,
      }).success,
    ).toBe(false);
  });
});
