import { z } from "zod";
import {
  CompletenessStateSchema,
  OfficialRuleEvaluationContextSchema,
  PresenceStateSchema,
  buildRuleCheck,
  evaluateScopeAndDate,
} from "./evaluation";
import {
  CaseRuleLocatorSchema,
  OfficialSourceReferenceSchema,
  type OfficialRuleCheck,
} from "./model";

export const AdvertisementExclusionInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("CURRENT_TERMS_PDF"),
  }).strict(),
  caseLocators: z.array(CaseRuleLocatorSchema).min(1).max(20),
  contractDocument: CompletenessStateSchema,
  advertisementExclusion: PresenceStateSchema,
})
  .strict()
  .superRefine((input, context) => {
    if (
      input.advertisementExclusion === "present" &&
      !input.caseLocators.some((locator) => locator.kind === "contract_text")
    ) {
      context.addIssue({
        code: "custom",
        path: ["caseLocators"],
        message: "A located advertisement-exclusion clause requires a contract_text locator",
      });
    }
  });

export type AdvertisementExclusionInput = z.infer<typeof AdvertisementExclusionInputSchema>;

const RULE = {
  ruleId: "RP-002",
  evaluatorId: "advertisement_exclusion_v1",
  effectiveDate: "2017-01-01",
} as const;

export function evaluateAdvertisementExclusion(input: unknown): OfficialRuleCheck {
  const parsed = AdvertisementExclusionInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (parsed.advertisementExclusion === "present") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "ADVERTISEMENT_EXCLUSION_TEXT",
    });
  }

  if (parsed.contractDocument !== "complete" || parsed.advertisementExclusion === "unknown") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "ADVERTISEMENT_EXCLUSION_INFORMATION_MISSING",
    });
  }

  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "ADVERTISEMENT_EXCLUSION_NOT_PRESENT_IN_COMPLETE_CONTRACT",
  });
}
