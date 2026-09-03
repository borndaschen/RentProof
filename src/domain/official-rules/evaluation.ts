import { z } from "zod";
import {
  CaseRuleLocatorSchema,
  OfficialRuleCheckSchema,
  OfficialSourceReferenceSchema,
  type OfficialRuleCheck,
  type OfficialRuleEvaluatorId,
  type OfficialRuleId,
  type OfficialRuleResult,
} from "./model";

export const KnowledgeStateSchema = z.enum(["known", "unknown"]);
export const PresenceStateSchema = z.enum(["present", "not_present", "unknown"]);
export const CompletenessStateSchema = z.enum(["complete", "incomplete", "unknown"]);

export const OfficialRuleEvaluationContextSchema = z
  .object({
    generalResidentialScope: z.union([z.boolean(), z.literal("unknown")]),
    intendedSignedAt: z.union([z.iso.date(), z.literal("unknown")]),
    officialSource: OfficialSourceReferenceSchema,
    caseLocators: z.array(CaseRuleLocatorSchema).min(1).max(20),
  })
  .strict();

export type OfficialRuleEvaluationContext = z.infer<typeof OfficialRuleEvaluationContextSchema>;

export function dateIsBefore(date: string, effectiveDate: string): boolean {
  return date < effectiveDate;
}

interface BuildRuleCheckInput {
  ruleId: OfficialRuleId;
  evaluatorId: OfficialRuleEvaluatorId;
  context: OfficialRuleEvaluationContext;
  applicability: OfficialRuleCheck["applicability"];
  result: OfficialRuleResult | null;
  reasonCode: string;
}

export function buildRuleCheck(input: BuildRuleCheckInput): OfficialRuleCheck {
  return OfficialRuleCheckSchema.parse({
    ruleId: input.ruleId,
    evaluatorId: input.evaluatorId,
    officialSource: input.context.officialSource,
    caseLocators: input.context.caseLocators,
    applicability: input.applicability,
    result: input.result,
    reasonCode: input.reasonCode,
  });
}

export function evaluateScopeAndDate(options: {
  context: OfficialRuleEvaluationContext;
  effectiveDate: string;
  ruleId: OfficialRuleId;
  evaluatorId: OfficialRuleEvaluatorId;
}): OfficialRuleCheck | null {
  if (
    options.context.generalResidentialScope === "unknown" ||
    options.context.intendedSignedAt === "unknown"
  ) {
    return buildRuleCheck({
      ...options,
      applicability: "unknown",
      result: "missing_information",
      reasonCode: "RULE_APPLICABILITY_UNKNOWN",
    });
  }
  if (
    !options.context.generalResidentialScope ||
    dateIsBefore(options.context.intendedSignedAt, options.effectiveDate)
  ) {
    return buildRuleCheck({
      ...options,
      applicability: "not_applicable",
      result: null,
      reasonCode: "RULE_NOT_APPLICABLE",
    });
  }
  return null;
}
