import { z } from "zod";
import {
  ClaimSchema,
  ContractClauseSchema,
  EvidenceGraphIdSchema,
  ModelConfidenceSchema,
  NonBlankTextSchema,
  NormalizedValueSchema,
  ObservationSchema,
  QualityFlagsSchema,
  SourceLocatorSchema,
} from "@/domain/evidence-graph";
import {
  NonNaturalDeathDisclosureStatementSchema,
  NonNaturalDeathEventTypeSchema,
  NonNaturalDeathPeriodSchema,
} from "@/domain/non-natural-death-disclosure";

export const TERRA_ANALYSIS_STAGES = [
  "listing.extract",
  "evidence.extract",
  "contract.extract",
  "interaction.extract",
] as const;

export const TerraAnalysisStageSchema = z.enum(TERRA_ANALYSIS_STAGES);
export type TerraAnalysisStage = z.infer<typeof TerraAnalysisStageSchema>;

const Base64Schema = z
  .string()
  .min(4)
  .max(40_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u);
const ImageMimeSchema = z.enum(["image/jpeg", "image/png"]);

const ImageInputSchema = z
  .object({
    artifactId: EvidenceGraphIdSchema,
    mime: ImageMimeSchema,
    base64: Base64Schema,
  })
  .strict();

const ListingAnalysisInputSchema = z
  .object({
    stage: z.literal("listing.extract"),
    caseId: EvidenceGraphIdSchema,
    artifact: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("text"),
          artifactId: EvidenceGraphIdSchema,
          text: z.string().min(1).max(100_000),
        })
        .strict(),
      z.object({ kind: z.literal("image"), image: ImageInputSchema }).strict(),
    ]),
  })
  .strict();

const EvidenceAnalysisInputSchema = z
  .object({
    stage: z.literal("evidence.extract"),
    caseId: EvidenceGraphIdSchema,
    images: z.array(ImageInputSchema).min(1).max(12),
  })
  .strict();

const ContractAnalysisInputSchema = z
  .object({
    stage: z.literal("contract.extract"),
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    pages: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(30),
            text: z.string().min(1).max(300_000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .superRefine((input, context) => {
    const total = input.pages.reduce((sum, page) => sum + [...page.text].length, 0);
    if (total > 300_000) {
      context.addIssue({ code: "custom", message: "CONTRACT_TEXT_LIMIT_EXCEEDED" });
    }
    if (new Set(input.pages.map((page) => page.page)).size !== input.pages.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_CONTRACT_PAGE" });
    }
  });

const InteractionAnalysisInputSchema = z
  .object({
    stage: z.literal("interaction.extract"),
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    synthetic: z.literal(true),
    text: z.string().min(1).max(100_000),
  })
  .strict();

export const TerraAnalysisInputSchema = z.discriminatedUnion("stage", [
  ListingAnalysisInputSchema,
  EvidenceAnalysisInputSchema,
  ContractAnalysisInputSchema,
  InteractionAnalysisInputSchema,
]);

export type TerraAnalysisInput = z.infer<typeof TerraAnalysisInputSchema>;

const ProviderSourceLocatorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("image"),
      locatorId: EvidenceGraphIdSchema,
      artifactId: EvidenceGraphIdSchema,
      bbox: z
        .object({
          xMin: z.number().min(0).max(1),
          yMin: z.number().min(0).max(1),
          xMax: z.number().min(0).max(1),
          yMax: z.number().min(0).max(1),
        })
        .strict(),
    })
    .strict()
    .superRefine((locator, context) => {
      if (locator.bbox.xMin >= locator.bbox.xMax) {
        context.addIssue({ code: "custom", message: "IMAGE_BBOX_X_RANGE_INVALID" });
      }
      if (locator.bbox.yMin >= locator.bbox.yMax) {
        context.addIssue({ code: "custom", message: "IMAGE_BBOX_Y_RANGE_INVALID" });
      }
    }),
  z
    .object({
      type: z.literal("pdf"),
      locatorId: EvidenceGraphIdSchema,
      artifactId: EvidenceGraphIdSchema,
      page: z.number().int().min(1).max(30),
      start: z.number().int().nonnegative().max(300_000),
      end: z.number().int().nonnegative().max(300_000),
      excerpt: NonBlankTextSchema,
    })
    .strict()
    .superRefine((locator, context) => {
      if (locator.start >= locator.end) {
        context.addIssue({ code: "custom", message: "PDF_TEXT_RANGE_INVALID" });
      }
    }),
  z
    .object({
      type: z.literal("text"),
      locatorId: EvidenceGraphIdSchema,
      artifactId: EvidenceGraphIdSchema,
      start: z.number().int().nonnegative().max(300_000),
      end: z.number().int().nonnegative().max(300_000),
      excerpt: NonBlankTextSchema,
    })
    .strict()
    .superRefine((locator, context) => {
      if (locator.start >= locator.end) {
        context.addIssue({ code: "custom", message: "TEXT_RANGE_INVALID" });
      }
    }),
  z
    .object({
      type: z.literal("video"),
      locatorId: EvidenceGraphIdSchema,
      artifactId: EvidenceGraphIdSchema,
      timestampMs: z.number().int().nonnegative(),
      frameNo: z.number().int().nonnegative(),
    })
    .strict(),
]);

export type ProviderSourceLocator = z.infer<typeof ProviderSourceLocatorSchema>;

export const RentalEvidenceKeySchema = z.enum([
  "monthly_rent",
  "management_fee",
  "electricity_unit_rate",
  "internet_included",
  "deposit_amount",
  "washing_machine",
  "air_conditioner",
  "refrigerator",
  "individual_electric_meter",
  "rent_subsidy",
  "independent_suite",
  "wall_discoloration",
  "non_natural_death_disclosure",
]);
const GenericRentalEvidenceKeySchema = RentalEvidenceKeySchema.exclude([
  "non_natural_death_disclosure",
]);

const ProviderClaimSchema = z
  .object({
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    source: z.enum(["listing", "spoken_promise"]),
    category: z.enum(["rent", "fee", "equipment", "condition", "subsidy", "other"]),
    key: GenericRentalEvidenceKeySchema,
    rawText: NonBlankTextSchema,
    normalizedValue: NormalizedValueSchema,
    modelConfidence: ModelConfidenceSchema.nullable(),
    qualityFlags: QualityFlagsSchema,
    locator: ProviderSourceLocatorSchema,
  })
  .strict();

const ProviderObservationSchema = z
  .object({
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    key: GenericRentalEvidenceKeySchema,
    description: NonBlankTextSchema,
    presence: z.enum(["observed", "not_shown", "unclear"]),
    observedValue: NormalizedValueSchema.nullable(),
    modelConfidence: ModelConfidenceSchema.nullable(),
    qualityFlags: QualityFlagsSchema,
    uncertaintyReason: z.string().min(1).max(500).nullable(),
    locator: ProviderSourceLocatorSchema,
  })
  .strict();

const ProviderContractClauseSchema = z
  .object({
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    semanticKey: GenericRentalEvidenceKeySchema,
    rawText: NonBlankTextSchema,
    normalizedValue: NormalizedValueSchema.nullable(),
    modelConfidence: ModelConfidenceSchema.nullable(),
    qualityFlags: QualityFlagsSchema,
    locator: ProviderSourceLocatorSchema,
  })
  .strict();

// This provider boundary deliberately permits only first-party contract documents.
// Rumors, news, address searches, listing copy and model inference cannot be represented
// as disclosure statements and therefore cannot become affirmative domain facts.
const ProviderNonNaturalDeathDisclosureStatementSchema = z
  .object({
    statementId: EvidenceGraphIdSchema,
    evidenceKey: z.literal("non_natural_death_disclosure"),
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    subjectScope: z.literal("exclusive_area"),
    period: NonNaturalDeathPeriodSchema,
    answer: z.enum(["yes", "no", "unknown"]),
    eventTypes: z.array(NonNaturalDeathEventTypeSchema).max(5),
    sourceKind: z.enum(["signed_status_confirmation", "contract_clause"]),
    signedByProvider: z.boolean(),
    locator: ProviderSourceLocatorSchema,
  })
  .strict()
  .superRefine((statement, context) => {
    if (statement.locator.type !== "pdf") {
      context.addIssue({
        code: "custom",
        path: ["locator"],
        message: "DISCLOSURE_PDF_LOCATOR_REQUIRED",
      });
    }
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

const ProviderPaymentRequestCueSchema = z
  .object({
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    requestedItem: z.enum(["deposit", "reservation_fee", "key_deposit", "rent", "other"]),
    amountMinor: z.number().int().nonnegative().nullable(),
    rawExcerpt: NonBlankTextSchema,
    locator: ProviderSourceLocatorSchema,
  })
  .strict();

export const ListingAnalysisEnvelopeSchema = z
  .object({
    stage: z.literal("listing.extract"),
    claims: z.array(ProviderClaimSchema).max(100),
  })
  .strict();
export const EvidenceAnalysisEnvelopeSchema = z
  .object({
    stage: z.literal("evidence.extract"),
    observations: z.array(ProviderObservationSchema).max(200),
  })
  .strict();
export const ContractAnalysisEnvelopeSchema = z
  .object({
    stage: z.literal("contract.extract"),
    clauses: z.array(ProviderContractClauseSchema).max(200),
    nonNaturalDeathDisclosureStatements: z
      .array(ProviderNonNaturalDeathDisclosureStatementSchema)
      .max(40),
  })
  .strict();
export const InteractionAnalysisEnvelopeSchema = z
  .object({
    stage: z.literal("interaction.extract"),
    paymentRequestCues: z.array(ProviderPaymentRequestCueSchema).max(50),
  })
  .strict();

export const TerraAnalysisProviderOutputSchema = z.discriminatedUnion("stage", [
  ListingAnalysisEnvelopeSchema,
  EvidenceAnalysisEnvelopeSchema,
  ContractAnalysisEnvelopeSchema,
  InteractionAnalysisEnvelopeSchema,
]);

export type TerraAnalysisProviderOutput = z.infer<typeof TerraAnalysisProviderOutputSchema>;

const PaymentRequestCueSchema = z
  .object({
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    requestedItem: z.enum(["deposit", "reservation_fee", "key_deposit", "rent", "other"]),
    amountMinor: z.number().int().nonnegative().nullable(),
    rawExcerpt: NonBlankTextSchema,
    locator: SourceLocatorSchema,
  })
  .strict();

export const TerraAnalysisOutputSchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("listing.extract"), claims: z.array(ClaimSchema).max(100) }).strict(),
  z
    .object({
      stage: z.literal("evidence.extract"),
      observations: z.array(ObservationSchema).max(200),
    })
    .strict(),
  z
    .object({
      stage: z.literal("contract.extract"),
      clauses: z.array(ContractClauseSchema).max(200),
      nonNaturalDeathDisclosureStatements: z
        .array(NonNaturalDeathDisclosureStatementSchema)
        .max(40),
    })
    .strict(),
  z
    .object({
      stage: z.literal("interaction.extract"),
      paymentRequestCues: z.array(PaymentRequestCueSchema).max(50),
    })
    .strict(),
]);

export type TerraAnalysisOutput = z.infer<typeof TerraAnalysisOutputSchema>;

export type AnalysisProviderReasonCode =
  | "ANALYSIS_PROVIDER_REFUSED"
  | "ANALYSIS_PROVIDER_INCOMPLETE"
  | "ANALYSIS_PROVIDER_SCHEMA_INVALID"
  | "ANALYSIS_PROVIDER_AUTH_FAILED"
  | "ANALYSIS_PROVIDER_RATE_LIMITED"
  | "ANALYSIS_LOCATOR_INVALID"
  | "ANALYSIS_PROVIDER_UNAVAILABLE";

export type AnalysisUsage =
  | Readonly<{
      known: true;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      totalTokens: number;
    }>
  | Readonly<{ known: false }>;

export type AnalysisProvenance = Readonly<{
  provider: "openai";
  endpoint: "responses.parse";
  stage: TerraAnalysisStage;
  requestedModel: "gpt-5.6-terra";
  resolvedModel: string;
  reasoningEffort: "medium";
  requestedServiceTier: "default";
  resolvedServiceTier: string | null;
  promptVersion: string;
  schemaVersion: "rentproof.terra-analysis.v2";
  providerRequestId: string;
  providerAttempts: number;
  usage: AnalysisUsage;
}>;

export type TerraAnalysisSuccess = Readonly<{
  output: TerraAnalysisOutput;
  sourceLocators: readonly z.infer<typeof SourceLocatorSchema>[];
  provenance: AnalysisProvenance;
}>;
