import { z } from "zod";
import { DecimalStringSchema, TwdMoneySchema } from "../costs";
import {
  OfficialRuleEvaluationContextSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import { OfficialSourceReferenceSchema, type OfficialRuleCheck } from "./model";

const MoneyKnowledgeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("known"), value: TwdMoneySchema }).strict(),
  z.object({ state: z.literal("not_present") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);

const DecimalKnowledgeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("known"), value: DecimalStringSchema }).strict(),
  z.object({ state: z.literal("not_present") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);

export const NonMeteredPublicElectricityInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("ELECTRICITY_2024"),
  }).strict(),
  electricityPayer: z.enum(["tenant", "landlord", "unknown"]),
  billingMode: z.enum(["per_kwh", "non_metered", "included", "unknown"]),
  chargedTotal: MoneyKnowledgeSchema,
  billTotalAmount: MoneyKnowledgeSchema,
  billUsageKwh: DecimalKnowledgeSchema,
  billMatch: z.enum(["same_property_same_period", "mismatch", "unknown"]),
  meterScope: z.enum(["same_rental_scope", "mismatch", "unknown"]),
  extraPublicCharge: z.enum(["charged", "not_charged", "unknown"]),
  publicAreaAllocation: z.enum(["included_in_bill", "not_in_bill", "unknown"]),
}).strict();

export type NonMeteredPublicElectricityInput = z.infer<
  typeof NonMeteredPublicElectricityInputSchema
>;

const RULE = {
  ruleId: "RP-007",
  evaluatorId: "non_metered_and_public_electricity_v1",
  effectiveDate: "2024-07-15",
} as const;

export function evaluateNonMeteredAndPublicElectricity(input: unknown): OfficialRuleCheck {
  const parsed = NonMeteredPublicElectricityInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (parsed.electricityPayer === "landlord") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "not_applicable",
      result: null,
      reasonCode: "RULE_NOT_APPLICABLE",
    });
  }
  if (
    parsed.electricityPayer === "unknown" ||
    parsed.billingMode === "unknown" ||
    (parsed.billingMode !== "non_metered" && parsed.extraPublicCharge === "unknown")
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "unknown",
      result: "missing_information",
      reasonCode: "RULE_APPLICABILITY_UNKNOWN",
    });
  }
  if (parsed.billingMode !== "non_metered" && parsed.extraPublicCharge === "not_charged") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "not_applicable",
      result: null,
      reasonCode: "RULE_NOT_APPLICABLE",
    });
  }

  const commonBillEvidenceMissing =
    parsed.billMatch !== "same_property_same_period" ||
    parsed.meterScope !== "same_rental_scope" ||
    parsed.billUsageKwh.state !== "known" ||
    parsed.billTotalAmount.state !== "known";
  const nonMeteredEvidenceMissing =
    parsed.billingMode === "non_metered" && parsed.chargedTotal.state !== "known";
  const publicEvidenceMissing =
    parsed.extraPublicCharge === "unknown" ||
    (parsed.extraPublicCharge === "charged" && parsed.publicAreaAllocation === "unknown");

  if (commonBillEvidenceMissing || nonMeteredEvidenceMissing || publicEvidenceMissing) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "NON_METERED_OR_PUBLIC_ELECTRICITY_INFORMATION_MISSING",
    });
  }

  if (
    parsed.billingMode === "non_metered" &&
    parsed.chargedTotal.state === "known" &&
    parsed.billTotalAmount.state === "known" &&
    BigInt(parsed.chargedTotal.value.minorUnits) > BigInt(parsed.billTotalAmount.value.minorUnits)
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "NON_METERED_CHARGE_ABOVE_BILL_TOTAL",
    });
  }

  if (parsed.extraPublicCharge === "charged" && parsed.publicAreaAllocation === "not_in_bill") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "PUBLIC_ELECTRICITY_CHARGED_OUTSIDE_BILL",
    });
  }

  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "NON_METERED_AND_PUBLIC_ELECTRICITY_NO_DIFFERENCE",
  });
}
