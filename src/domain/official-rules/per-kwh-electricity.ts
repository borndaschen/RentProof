import { z } from "zod";
import { DecimalStringSchema, type DecimalString } from "../costs";
import {
  OfficialRuleEvaluationContextSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import { OfficialSourceReferenceSchema, type OfficialRuleCheck } from "./model";

const DecimalKnowledgeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("known"), value: DecimalStringSchema }).strict(),
  z.object({ state: z.literal("not_present") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);

export const PerKwhElectricityInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("ELECTRICITY_2024"),
  }).strict(),
  electricityPayer: z.enum(["tenant", "landlord", "unknown"]),
  billingMode: z.enum(["per_kwh", "non_metered", "included", "unknown"]),
  chargedRate: DecimalKnowledgeSchema,
  billAverageUnitPrice: DecimalKnowledgeSchema,
  billMatch: z.enum(["same_property_same_period", "mismatch", "unknown"]),
}).strict();

export type PerKwhElectricityInput = z.infer<typeof PerKwhElectricityInputSchema>;

const RULE = {
  ruleId: "RP-006",
  evaluatorId: "per_kwh_electricity_v1",
  effectiveDate: "2024-07-15",
} as const;

interface ComparableDecimal {
  coefficient: bigint;
  scale: number;
}

function parseComparableDecimal(value: DecimalString): ComparableDecimal {
  const [whole, fraction = ""] = value.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

export function compareDecimalStrings(left: DecimalString, right: DecimalString): -1 | 0 | 1 {
  const leftValue = parseComparableDecimal(left);
  const rightValue = parseComparableDecimal(right);
  const scale = Math.max(leftValue.scale, rightValue.scale);
  const leftCoefficient = leftValue.coefficient * 10n ** BigInt(scale - leftValue.scale);
  const rightCoefficient = rightValue.coefficient * 10n ** BigInt(scale - rightValue.scale);
  if (leftCoefficient > rightCoefficient) return 1;
  if (leftCoefficient < rightCoefficient) return -1;
  return 0;
}

export function evaluatePerKwhElectricity(input: unknown): OfficialRuleCheck {
  const parsed = PerKwhElectricityInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (
    parsed.electricityPayer === "landlord" ||
    ["non_metered", "included"].includes(parsed.billingMode)
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "not_applicable",
      result: null,
      reasonCode: "RULE_NOT_APPLICABLE",
    });
  }
  if (parsed.electricityPayer === "unknown" || parsed.billingMode === "unknown") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "unknown",
      result: "missing_information",
      reasonCode: "RULE_APPLICABILITY_UNKNOWN",
    });
  }
  if (
    parsed.billMatch !== "same_property_same_period" ||
    parsed.chargedRate.state !== "known" ||
    parsed.billAverageUnitPrice.state !== "known"
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "SAME_PROPERTY_PERIOD_BILL_MISSING",
    });
  }
  if (compareDecimalStrings(parsed.chargedRate.value, parsed.billAverageUnitPrice.value) > 0) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "ELECTRICITY_RATE_ABOVE_BILL_AVERAGE",
    });
  }
  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "ELECTRICITY_RATE_NOT_ABOVE_BILL_AVERAGE",
  });
}
