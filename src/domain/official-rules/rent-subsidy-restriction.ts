import { z } from "zod";
import {
  CompletenessStateSchema,
  PresenceStateSchema,
  OfficialRuleEvaluationContextSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import { OfficialSourceReferenceSchema, type OfficialRuleCheck } from "./model";

export const RentSubsidyRestrictionInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("SUBSIDY_2023"),
  }).strict(),
  contractDocument: CompletenessStateSchema,
  restrictionClause: PresenceStateSchema,
}).strict();

export type RentSubsidyRestrictionInput = z.infer<typeof RentSubsidyRestrictionInputSchema>;

const RULE = {
  ruleId: "RP-010",
  evaluatorId: "rent_subsidy_restriction_v1",
  effectiveDate: "2023-06-14",
} as const;

export function evaluateRentSubsidyRestriction(input: unknown): OfficialRuleCheck {
  const parsed = RentSubsidyRestrictionInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (parsed.restrictionClause === "present") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "RENT_SUBSIDY_RESTRICTION_TEXT",
    });
  }
  if (parsed.contractDocument !== "complete" || parsed.restrictionClause === "unknown") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "RENT_SUBSIDY_CLAUSE_UNKNOWN",
    });
  }
  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "RENT_SUBSIDY_RESTRICTION_NOT_PRESENT_IN_COMPLETE_CONTRACT",
  });
}
