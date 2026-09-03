import { z } from "zod";
import {
  OfficialRuleEvaluationContextSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import { OfficialSourceReferenceSchema, type OfficialRuleCheck } from "./model";

export const ElectricityInformationInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("ELECTRICITY_2024"),
  }).strict(),
  electricityPayer: z.enum(["tenant", "landlord", "unknown"]),
  billInformation: z
    .object({
      averageUnitPrice: z.enum(["present", "missing", "unknown"]),
      usageKwh: z.enum(["present", "missing", "unknown"]),
      totalAmount: z.enum(["present", "missing", "unknown"]),
      publicAreaAllocation: z.enum(["present", "missing", "unknown"]),
    })
    .strict(),
  blocksTenantBillInquiry: z.enum(["yes", "no", "unknown"]),
}).strict();

export type ElectricityInformationInput = z.infer<typeof ElectricityInformationInputSchema>;

const RULE = {
  ruleId: "RP-008",
  evaluatorId: "electricity_information_v1",
  effectiveDate: "2024-07-15",
} as const;

export function evaluateElectricityInformation(input: unknown): OfficialRuleCheck {
  const parsed = ElectricityInformationInputSchema.parse(input);
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
  if (parsed.electricityPayer === "unknown") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "unknown",
      result: "missing_information",
      reasonCode: "RULE_APPLICABILITY_UNKNOWN",
    });
  }
  if (parsed.blocksTenantBillInquiry === "yes") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "TENANT_BILL_INQUIRY_RESTRICTED",
    });
  }
  if (
    parsed.blocksTenantBillInquiry === "unknown" ||
    Object.values(parsed.billInformation).some((value) => value !== "present")
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "ELECTRICITY_INFORMATION_MISSING",
    });
  }
  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "ELECTRICITY_INFORMATION_PRESENT",
  });
}
