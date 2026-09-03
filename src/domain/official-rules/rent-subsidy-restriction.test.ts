import { describe, expect, it } from "vitest";
import {
  RentSubsidyRestrictionInputSchema,
  evaluateRentSubsidyRestriction,
} from "./rent-subsidy-restriction";
import { baseContext, caseLocators, sourceWithId } from "./test-fixtures";

const officialSource = sourceWithId("SUBSIDY_2023");
const context = { ...baseContext, officialSource } as const;

describe("evaluateRentSubsidyRestriction", () => {
  it("flags a located restriction even when the rest of the document is incomplete", () => {
    expect(
      evaluateRentSubsidyRestriction({
        ...context,
        contractDocument: "incomplete",
        restrictionClause: "present",
      }),
    ).toMatchObject({
      result: "possible_difference",
      reasonCode: "RENT_SUBSIDY_RESTRICTION_TEXT",
      officialSource,
      caseLocators,
    });
  });

  it("returns missing information for incomplete documents or unknown clauses", () => {
    for (const input of [
      { ...context, contractDocument: "incomplete", restrictionClause: "not_present" },
      { ...context, contractDocument: "complete", restrictionClause: "unknown" },
    ]) {
      expect(evaluateRentSubsidyRestriction(input)).toMatchObject({
        result: "missing_information",
        reasonCode: "RENT_SUBSIDY_CLAUSE_UNKNOWN",
      });
    }
  });

  it("returns no difference only for confirmed absence in a complete contract", () => {
    expect(
      evaluateRentSubsidyRestriction({
        ...context,
        contractDocument: "complete",
        restrictionClause: "not_present",
      }),
    ).toMatchObject({
      result: "no_difference_found",
      reasonCode: "RENT_SUBSIDY_RESTRICTION_NOT_PRESENT_IN_COMPLETE_CONTRACT",
    });
  });

  it("applies the date gate and rejects unknown keys", () => {
    expect(
      evaluateRentSubsidyRestriction({
        ...context,
        intendedSignedAt: "2023-06-13",
        contractDocument: "complete",
        restrictionClause: "present",
      }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
    expect(
      RentSubsidyRestrictionInputSchema.safeParse({
        ...context,
        contractDocument: "complete",
        restrictionClause: "not_present",
        extra: true,
      }).success,
    ).toBe(false);
  });
});
