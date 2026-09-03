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
  type CaseRuleLocator,
  type OfficialRuleCheck,
} from "./model";

const ReviewDaysSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("known"), value: z.number().int().min(0).max(365) }).strict(),
  z.object({ state: z.literal("not_present") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);

const ContractDeliveryDateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("known"), value: z.iso.date() }).strict(),
  z.object({ state: z.literal("not_present") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);

function hasContractTextLocator(locators: readonly CaseRuleLocator[]): boolean {
  return locators.some((locator) => locator.kind === "contract_text");
}

export const ReviewPeriodInputSchema = OfficialRuleEvaluationContextSchema.extend({
  officialSource: OfficialSourceReferenceSchema.extend({
    sourceId: z.literal("CURRENT_TERMS_PDF"),
  }).strict(),
  caseLocators: z.array(CaseRuleLocatorSchema).min(1).max(20),
  contractDocument: CompletenessStateSchema,
  explicitReviewDays: ReviewDaysSchema,
  contractDeliveredAt: ContractDeliveryDateSchema,
  reviewWaiverText: PresenceStateSchema,
})
  .strict()
  .superRefine((input, context) => {
    if (input.reviewWaiverText === "present" && !hasContractTextLocator(input.caseLocators)) {
      context.addIssue({
        code: "custom",
        path: ["caseLocators"],
        message: "A located review-waiver clause requires a contract_text locator",
      });
    }
  });

export type ReviewPeriodInput = z.infer<typeof ReviewPeriodInputSchema>;

const RULE = {
  ruleId: "RP-001",
  evaluatorId: "review_period_v1",
  effectiveDate: "2017-01-01",
} as const;

const MILLISECONDS_PER_DAY = 86_400_000;

export function daysBetweenCalendarDates(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  return (toTime - fromTime) / MILLISECONDS_PER_DAY;
}

export function evaluateReviewPeriod(input: unknown): OfficialRuleCheck {
  const parsed = ReviewPeriodInputSchema.parse(input);
  const scopeResult = evaluateScopeAndDate({ context: parsed, ...RULE });
  if (scopeResult !== null) return scopeResult;

  if (parsed.reviewWaiverText === "present") {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "REVIEW_PERIOD_WAIVER_TEXT",
    });
  }

  const reviewDays =
    parsed.explicitReviewDays.state === "known"
      ? parsed.explicitReviewDays.value
      : parsed.contractDeliveredAt.state === "known"
        ? daysBetweenCalendarDates(parsed.contractDeliveredAt.value, parsed.intendedSignedAt)
        : null;

  if (reviewDays !== null && reviewDays < 3) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "possible_difference",
      reasonCode: "REVIEW_PERIOD_UNDER_THREE_DAYS",
    });
  }

  if (
    parsed.contractDocument !== "complete" ||
    parsed.reviewWaiverText === "unknown" ||
    reviewDays === null
  ) {
    return buildRuleCheck({
      context: parsed,
      ...RULE,
      applicability: "applicable",
      result: "missing_information",
      reasonCode: "REVIEW_PERIOD_INFORMATION_MISSING",
    });
  }

  return buildRuleCheck({
    context: parsed,
    ...RULE,
    applicability: "applicable",
    result: "no_difference_found",
    reasonCode: "REVIEW_PERIOD_AT_LEAST_THREE_DAYS_NO_WAIVER_FOUND",
  });
}
