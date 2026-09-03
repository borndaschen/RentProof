import { z } from "zod";
import {
  CompletenessStateSchema,
  PresenceStateSchema,
  OfficialRuleEvaluationContextSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import { OfficialSourceReferenceSchema, type OfficialRuleCheck } from "./model";

export const RepairResponsibilityInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("CURRENT_TERMS_PDF"),
  }).strict(),
  tenantRepairItems: CompletenessStateSchema,
  repairContact: PresenceStateSchema,
  assignsAllRepairsWithoutItemization: z.enum(["yes", "no", "unknown"]),
}).strict();

export type RepairResponsibilityInput = z.infer<typeof RepairResponsibilityInputSchema>;

const RULE = {
  ruleId: "RP-009",
  evaluatorId: "repair_responsibility_v1",
  effectiveDate: "2020-09-01",
} as const;

export function evaluateRepairResponsibility(input: unknown): OfficialRuleCheck {
  const parsed = RepairResponsibilityInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (parsed.assignsAllRepairsWithoutItemization === "yes") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "REPAIRS_ASSIGNED_WITHOUT_ITEMIZATION",
    });
  }
  if (
    parsed.tenantRepairItems !== "complete" ||
    parsed.repairContact !== "present" ||
    parsed.assignsAllRepairsWithoutItemization === "unknown"
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "REPAIR_SCOPE_OR_CONTACT_MISSING",
    });
  }
  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "REPAIR_SCOPE_AND_CONTACT_PRESENT",
  });
}
