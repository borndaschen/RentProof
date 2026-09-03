import { z } from "zod";
import {
  CompletenessStateSchema,
  PresenceStateSchema,
  OfficialRuleEvaluationContextSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import { OfficialSourceReferenceSchema, type OfficialRuleCheck } from "./model";

export const RentalScopeEquipmentInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("CONTRACT_TEMPLATE"),
  }).strict(),
  contractDocument: CompletenessStateSchema,
  rentalScope: CompletenessStateSchema,
  equipmentAppendix: PresenceStateSchema,
}).strict();

export type RentalScopeEquipmentInput = z.infer<typeof RentalScopeEquipmentInputSchema>;

const RULE = {
  ruleId: "RP-003",
  evaluatorId: "rental_scope_and_equipment_v1",
  effectiveDate: "2017-01-01",
} as const;

export function evaluateRentalScopeAndEquipment(input: unknown): OfficialRuleCheck {
  const parsed = RentalScopeEquipmentInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (
    parsed.contractDocument !== "complete" ||
    parsed.rentalScope !== "complete" ||
    parsed.equipmentAppendix !== "present"
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "RENTAL_SCOPE_OR_EQUIPMENT_MISSING",
    });
  }
  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "RENTAL_SCOPE_AND_EQUIPMENT_PRESENT",
  });
}
