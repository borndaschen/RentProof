import { z } from "zod";
import {
  CompletenessStateSchema,
  PresenceStateSchema,
  OfficialRuleEvaluationContextSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import { OfficialSourceReferenceSchema, type OfficialRuleCheck } from "./model";

export const RentAndFeesInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("CURRENT_TERMS_PDF"),
  }).strict(),
  contractDocument: CompletenessStateSchema,
  monthlyRent: PresenceStateSchema,
  fees: CompletenessStateSchema,
  allowsUnilateralRentIncrease: z.enum(["yes", "no", "unknown"]),
}).strict();

export type RentAndFeesInput = z.infer<typeof RentAndFeesInputSchema>;

const RULE = {
  ruleId: "RP-004",
  evaluatorId: "rent_and_fees_v1",
  effectiveDate: "2020-09-01",
} as const;

export function evaluateRentAndFees(input: unknown): OfficialRuleCheck {
  const parsed = RentAndFeesInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (parsed.allowsUnilateralRentIncrease === "yes") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "UNILATERAL_RENT_INCREASE_TEXT",
    });
  }
  if (
    parsed.contractDocument !== "complete" ||
    parsed.monthlyRent !== "present" ||
    parsed.fees !== "complete" ||
    parsed.allowsUnilateralRentIncrease === "unknown"
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "RENT_OR_FEES_INCOMPLETE",
    });
  }
  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "RENT_AND_FEES_COMPLETE",
  });
}
