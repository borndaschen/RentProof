import { z } from "zod";
import { TwdMoneySchema } from "../costs";
import {
  OfficialRuleEvaluationContextSchema,
  PresenceStateSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import { OfficialSourceReferenceSchema, type OfficialRuleCheck } from "./model";

const MoneyKnowledgeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("known"), value: TwdMoneySchema }).strict(),
  z.object({ state: z.literal("not_present") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);

export const DepositLimitAndReturnInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("CURRENT_TERMS_PDF"),
  }).strict(),
  monthlyRent: MoneyKnowledgeSchema,
  depositAmount: MoneyKnowledgeSchema,
  depositReturnTerms: PresenceStateSchema,
}).strict();

export type DepositLimitAndReturnInput = z.infer<typeof DepositLimitAndReturnInputSchema>;

const RULE = {
  ruleId: "RP-005",
  evaluatorId: "deposit_limit_and_return_v1",
  effectiveDate: "2017-01-01",
} as const;

export function evaluateDepositLimitAndReturn(input: unknown): OfficialRuleCheck {
  const parsed = DepositLimitAndReturnInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (parsed.monthlyRent.state === "known" && parsed.depositAmount.state === "known") {
    const twoMonthsRent = BigInt(parsed.monthlyRent.value.minorUnits) * 2n;
    const deposit = BigInt(parsed.depositAmount.value.minorUnits);
    if (deposit > twoMonthsRent) {
      return buildRuleCheck({
        context: parsed,
        ...RULE,
        applicability: "applicable",
        result: "possible_difference",
        reasonCode: "DEPOSIT_ABOVE_TWO_MONTHS_RENT",
      });
    }
  }

  if (
    parsed.monthlyRent.state !== "known" ||
    parsed.depositAmount.state !== "known" ||
    parsed.depositReturnTerms !== "present"
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "DEPOSIT_OR_RETURN_TERMS_MISSING",
    });
  }

  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "DEPOSIT_WITHIN_TWO_MONTHS_AND_RETURN_TERMS_PRESENT",
  });
}
