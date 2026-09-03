import { z } from "zod";

export const OfficialRuleResultSchema = z.enum([
  "no_difference_found",
  "possible_difference",
  "missing_information",
]);

export const RuleApplicabilitySchema = z.enum(["applicable", "not_applicable", "unknown"]);

export const OfficialRuleIdSchema = z.enum([
  "RP-001",
  "RP-002",
  "RP-003",
  "RP-004",
  "RP-005",
  "RP-006",
  "RP-007",
  "RP-008",
  "RP-009",
  "RP-010",
]);

export const OfficialRuleEvaluatorIdSchema = z.enum([
  "review_period_v1",
  "advertisement_exclusion_v1",
  "rental_scope_and_equipment_v1",
  "rent_and_fees_v1",
  "deposit_limit_and_return_v1",
  "per_kwh_electricity_v1",
  "non_metered_and_public_electricity_v1",
  "electricity_information_v1",
  "repair_responsibility_v1",
  "rent_subsidy_restriction_v1",
]);

const RULE_EVALUATOR_PAIRS = {
  "RP-001": "review_period_v1",
  "RP-002": "advertisement_exclusion_v1",
  "RP-003": "rental_scope_and_equipment_v1",
  "RP-004": "rent_and_fees_v1",
  "RP-005": "deposit_limit_and_return_v1",
  "RP-006": "per_kwh_electricity_v1",
  "RP-007": "non_metered_and_public_electricity_v1",
  "RP-008": "electricity_information_v1",
  "RP-009": "repair_responsibility_v1",
  "RP-010": "rent_subsidy_restriction_v1",
} as const;

export const OfficialSourceReferenceSchema = z
  .object({
    sourceId: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
    title: z.string().trim().min(1).max(240),
    publisher: z.string().trim().min(1).max(120),
    url: z.url().refine((url) => url.startsWith("https://"), "Official source must use HTTPS"),
    snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    ruleLocator: z.string().trim().min(1).max(240),
    rulesetVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u),
  })
  .strict();

export const CaseRuleLocatorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("case_field"),
      field: z.string().regex(/^[a-z][a-z0-9_.]{0,127}$/u),
    })
    .strict(),
  z
    .object({
      kind: z.literal("contract_text"),
      artifactId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/u),
      page: z.number().int().positive(),
      excerpt: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("contract_attachment"),
      artifactId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/u),
      attachmentName: z.string().trim().min(1).max(160),
      page: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bill_field"),
      artifactId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/u),
      field: z.enum(["average_unit_price", "usage_kwh", "total_amount", "public_area_allocation"]),
      page: z.number().int().positive(),
    })
    .strict(),
]);

export const OfficialRuleDefinitionSchema = z
  .object({
    id: OfficialRuleIdSchema,
    title: z.string().trim().min(1).max(160),
    evaluatorId: OfficialRuleEvaluatorIdSchema,
    ruleVersion: z.string().min(1).max(64),
    effectiveDate: z.iso.date(),
    source: OfficialSourceReferenceSchema,
  })
  .strict()
  .superRefine((definition, context) => {
    if (RULE_EVALUATOR_PAIRS[definition.id] !== definition.evaluatorId) {
      context.addIssue({
        code: "custom",
        message: "Rule id and evaluator id do not match the allowlist",
        path: ["evaluatorId"],
      });
    }
  });

const RuleCheckBaseSchema = z.object({
  ruleId: OfficialRuleIdSchema,
  evaluatorId: OfficialRuleEvaluatorIdSchema,
  officialSource: OfficialSourceReferenceSchema,
  caseLocators: z.array(CaseRuleLocatorSchema).min(1).max(20),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,95}$/u),
});

export const OfficialRuleCheckSchema = z.discriminatedUnion("applicability", [
  RuleCheckBaseSchema.extend({
    applicability: z.literal("not_applicable"),
    result: z.null(),
  }).strict(),
  RuleCheckBaseSchema.extend({
    applicability: z.literal("unknown"),
    result: z.literal("missing_information"),
  }).strict(),
  RuleCheckBaseSchema.extend({
    applicability: z.literal("applicable"),
    result: OfficialRuleResultSchema,
  }).strict(),
]);

export type OfficialRuleResult = z.infer<typeof OfficialRuleResultSchema>;
export type RuleApplicability = z.infer<typeof RuleApplicabilitySchema>;
export type OfficialRuleId = z.infer<typeof OfficialRuleIdSchema>;
export type OfficialRuleEvaluatorId = z.infer<typeof OfficialRuleEvaluatorIdSchema>;
export type OfficialSourceReference = z.infer<typeof OfficialSourceReferenceSchema>;
export type CaseRuleLocator = z.infer<typeof CaseRuleLocatorSchema>;
export type OfficialRuleDefinition = z.infer<typeof OfficialRuleDefinitionSchema>;
export type OfficialRuleCheck = z.infer<typeof OfficialRuleCheckSchema>;
