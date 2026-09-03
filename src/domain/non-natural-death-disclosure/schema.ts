import { z } from "zod";
import { SourceLocatorSchema } from "../evidence-graph";

export const NonNaturalDeathPeriodSchema = z.enum([
  "during_owner_holding",
  "before_owner_holding_known",
]);
export const ExplicitDisclosureAnswerSchema = z.enum(["yes", "no", "unknown"]);
export const NonNaturalDeathEventTypeSchema = z.enum([
  "homicide",
  "suicide",
  "carbon_monoxide_poisoning",
  "other_non_natural_death",
  "unspecified_non_natural_death",
]);
export const DisclosureSourceKindSchema = z.enum([
  "signed_status_confirmation",
  "contract_clause",
  "landlord_written_statement",
  "agent_written_statement",
  "listing_text",
  "rumor",
  "address_search",
  "news_report",
  "model_inference",
]);

export const NonNaturalDeathDisclosureStatementSchema = z
  .object({
    statementId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    subjectScope: z.literal("exclusive_area"),
    period: NonNaturalDeathPeriodSchema,
    answer: ExplicitDisclosureAnswerSchema,
    eventTypes: z.array(NonNaturalDeathEventTypeSchema).max(5),
    sourceKind: DisclosureSourceKindSchema,
    signedByProvider: z.boolean(),
    locator: SourceLocatorSchema.optional(),
  })
  .strict()
  .superRefine((statement, context) => {
    if (statement.answer === "yes" && statement.eventTypes.length === 0) {
      context.addIssue({ code: "custom", message: "AFFIRMATIVE_EVENT_TYPE_REQUIRED" });
    }
    if (statement.answer !== "yes" && statement.eventTypes.length !== 0) {
      context.addIssue({ code: "custom", message: "NON_AFFIRMATIVE_EVENT_TYPE_FORBIDDEN" });
    }
    if (statement.signedByProvider !== (statement.sourceKind === "signed_status_confirmation")) {
      context.addIssue({ code: "custom", message: "SIGNED_SOURCE_FLAG_MISMATCH" });
    }
  });

export const NonNaturalDeathDisclosureInputSchema = z
  .object({
    statements: z.array(NonNaturalDeathDisclosureStatementSchema).max(40),
  })
  .strict();

export const NonNaturalDeathDisclosureCheckSchema = z
  .object({
    period: NonNaturalDeathPeriodSchema,
    status: z.enum(["supported", "contradicted", "insufficient_evidence"]),
    disclosedAnswer: ExplicitDisclosureAnswerSchema,
    reasonCode: z.enum([
      "EXPLICIT_DISCLOSURE_SUPPORTED",
      "EXPLICIT_DISCLOSURES_CONFLICT",
      "EXPLICIT_DISCLOSURE_MISSING",
      "ONLY_UNVERIFIED_SOURCES_PROVIDED",
    ]),
    sourceLocators: z.array(SourceLocatorSchema).max(40),
  })
  .strict();

export const NonNaturalDeathDisclosureResultSchema = z
  .object({
    schema: z.literal("rentproof.non-natural-death-disclosure.v1"),
    subjectScope: z.literal("exclusive_area"),
    checks: z.tuple([NonNaturalDeathDisclosureCheckSchema, NonNaturalDeathDisclosureCheckSchema]),
    actions: z.array(
      z.enum([
        "obtain_signed_status_confirmation",
        "ask_landlord_or_agent_in_writing",
        "preserve_located_source_copy",
      ]),
    ),
    excludedUnverifiedSourceCount: z.number().int().nonnegative().max(40),
    humanReviewRequired: z.literal(true),
  })
  .strict();

export type NonNaturalDeathDisclosureInput = z.infer<typeof NonNaturalDeathDisclosureInputSchema>;
export type NonNaturalDeathDisclosureStatement = z.infer<
  typeof NonNaturalDeathDisclosureStatementSchema
>;
export type NonNaturalDeathDisclosureResult = z.infer<typeof NonNaturalDeathDisclosureResultSchema>;
