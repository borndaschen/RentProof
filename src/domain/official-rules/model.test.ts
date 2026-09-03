import { describe, expect, it } from "vitest";
import {
  OfficialRuleCheckSchema,
  OfficialRuleDefinitionSchema,
  OfficialRuleResultSchema,
} from "./model";
import { caseLocators, officialSource } from "./test-fixtures";

const rulePairs = [
  ["RP-001", "review_period_v1"],
  ["RP-002", "advertisement_exclusion_v1"],
  ["RP-003", "rental_scope_and_equipment_v1"],
  ["RP-004", "rent_and_fees_v1"],
  ["RP-005", "deposit_limit_and_return_v1"],
  ["RP-006", "per_kwh_electricity_v1"],
  ["RP-007", "non_metered_and_public_electricity_v1"],
  ["RP-008", "electricity_information_v1"],
  ["RP-009", "repair_responsibility_v1"],
  ["RP-010", "rent_subsidy_restriction_v1"],
] as const;

describe("official rule domain model", () => {
  it("supports the allowlisted ten-rule catalog and rejects mismatched evaluator ids", () => {
    for (const [id, evaluatorId] of rulePairs) {
      expect(
        OfficialRuleDefinitionSchema.safeParse({
          id,
          title: id,
          evaluatorId,
          ruleVersion: "1.0.0-draft",
          effectiveDate: "2024-01-01",
          source: officialSource,
        }).success,
      ).toBe(true);
    }
    expect(
      OfficialRuleDefinitionSchema.safeParse({
        id: "RP-008",
        title: "錯誤配對",
        evaluatorId: "review_period_v1",
        ruleVersion: "1.0.0-draft",
        effectiveDate: "2024-01-01",
        source: officialSource,
      }).success,
    ).toBe(false);
  });

  it("permits only the three neutral result values", () => {
    expect(OfficialRuleResultSchema.options).toEqual([
      "no_difference_found",
      "possible_difference",
      "missing_information",
    ]);
    expect(OfficialRuleResultSchema.safeParse("passed").success).toBe(false);
    expect(OfficialRuleResultSchema.safeParse("failed").success).toBe(false);
  });

  it("requires official source and at least one case locator on every check", () => {
    const check = {
      ruleId: "RP-008",
      evaluatorId: "electricity_information_v1",
      officialSource,
      caseLocators,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "ELECTRICITY_INFORMATION_MISSING",
    };
    expect(OfficialRuleCheckSchema.safeParse(check).success).toBe(true);
    expect(OfficialRuleCheckSchema.safeParse({ ...check, caseLocators: [] }).success).toBe(false);
    const { officialSource: omittedSource, ...withoutSource } = check;
    expect(omittedSource).toBe(officialSource);
    expect(OfficialRuleCheckSchema.safeParse(withoutSource).success).toBe(false);
  });

  it("rejects unknown keys and invalid skipped-result combinations", () => {
    const base = {
      ruleId: "RP-008",
      evaluatorId: "electricity_information_v1",
      officialSource,
      caseLocators,
      applicability: "not_applicable",
      result: null,
      reasonCode: "RULE_NOT_APPLICABLE",
    };
    expect(OfficialRuleCheckSchema.safeParse({ ...base, unknown: true }).success).toBe(false);
    expect(
      OfficialRuleCheckSchema.safeParse({ ...base, result: "no_difference_found" }).success,
    ).toBe(false);
  });
});
