import { z } from "zod";
import { NonNaturalDeathDisclosureResultSchema } from "@/domain/non-natural-death-disclosure";
import {
  OfficialRuleIdSchema,
  OfficialRuleProfileSchema,
  isCompleteOfficialRuleProfile,
  officialRuleIdsForProfile,
} from "@/domain/official-rules";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const LIVE_TERRA_STAGE_ORDER = [
  "listing.extract",
  "evidence.extract",
  "contract.extract",
  "interaction.extract",
] as const;

export const LiveAnalysisStageRunSchema = z
  .object({
    stage: z.enum(LIVE_TERRA_STAGE_ORDER),
    status: z.literal("succeeded"),
    outputHash: Sha256Schema,
    providerRequestId: z.string().min(1).max(128),
    providerAttempts: z.number().int().min(1).max(16),
    requestedModel: z.literal("gpt-5.6-terra"),
    resolvedModel: z.string().min(1).max(128),
    reasoningEffort: z.literal("medium"),
    requestedServiceTier: z.literal("default"),
    resolvedServiceTier: z.string().min(1).max(64).nullable(),
    promptVersion: z.string().min(1).max(64),
    schemaVersion: z.literal("rentproof.terra-analysis.v2"),
    usage: z.discriminatedUnion("known", [
      z
        .object({
          known: z.literal(true),
          inputTokens: z.number().int().nonnegative(),
          cachedInputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
          reasoningTokens: z.number().int().nonnegative(),
          totalTokens: z.number().int().nonnegative(),
        })
        .strict(),
      z.object({ known: z.literal(false) }).strict(),
    ]),
  })
  .strict();

const FindingSchema = z
  .object({
    claimId: OpaqueIdSchema,
    status: z.enum(["supported", "contradicted", "insufficient_evidence"]),
    sourceRefs: z.array(OpaqueIdSchema).min(1).max(8),
  })
  .strict();

const RuleCheckSchema = z
  .object({
    ruleId: OfficialRuleIdSchema,
    result: z.enum(["no_difference_found", "possible_difference", "missing_information"]),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
    sourceRefs: z.array(OpaqueIdSchema).min(1).max(8),
  })
  .strict();

const FraudSignalSchema = z
  .object({
    signalId: z.literal("FRS-001"),
    status: z.enum(["detected", "not_detected_in_provided_data", "insufficient_information"]),
    action: z.enum(["review", "stop_and_verify"]),
    reasonCode: z.enum([
      "FRS_001_PAYMENT_BEFORE_VIEWING",
      "FRS_001_PAYMENT_NOT_BEFORE_VIEWING",
      "FRS_001_PAYMENT_EVIDENCE_MISSING",
      "FRS_001_TIMELINE_INCOMPLETE",
    ]),
    sourceRefs: z.array(OpaqueIdSchema).max(8),
  })
  .strict();

const BudgetSchema = z
  .object({
    providerAttempts: z.number().int().min(1).max(16),
    inputTokens: z.number().int().nonnegative().max(500_000),
    outputAndReasoningTokens: z.number().int().nonnegative().max(50_000),
    cachedInputTokens: z.number().int().nonnegative().max(500_000),
    engineeringAlertReached: z.boolean(),
    usageKnown: z.boolean(),
  })
  .strict();

export const PublicLiveAnalysisSnapshotSchema = z
  .object({
    schemaVersion: z.literal("rentproof.live-analysis-snapshot.v1"),
    snapshotId: OpaqueIdSchema,
    caseVersion: z.literal("golden-v1"),
    manifestHash: Sha256Schema,
    executionMode: z.literal("live"),
    providerCalled: z.literal(true),
    ruleProfile: OfficialRuleProfileSchema,
    stageRuns: z.array(LiveAnalysisStageRunSchema).length(LIVE_TERRA_STAGE_ORDER.length),
    budget: BudgetSchema,
    configurationWarnings: z.array(z.literal("OPENAI_PROJECT_LIMITS_UNVERIFIED")).max(1),
    findings: z.array(FindingSchema).max(100),
    ruleChecks: z.array(RuleCheckSchema).min(6).max(10),
    fraudSignals: z.array(FraudSignalSchema).length(1),
    nonNaturalDeathDisclosure: NonNaturalDeathDisclosureResultSchema,
    nextActions: z.array(z.string().min(1).max(240)).min(1).max(10),
    reportHref: z.literal("/reports/golden-v1"),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.stageRuns.some((run, index) => run.stage !== LIVE_TERRA_STAGE_ORDER[index])) {
      context.addIssue({ code: "custom", message: "LIVE_STAGE_ORDER_INVALID" });
    }
    const ruleIds = snapshot.ruleChecks.map((check) => check.ruleId);
    if (
      !isCompleteOfficialRuleProfile(ruleIds) ||
      JSON.stringify([...ruleIds].sort()) !==
        JSON.stringify([...officialRuleIdsForProfile(snapshot.ruleProfile)].sort())
    ) {
      context.addIssue({ code: "custom", message: "LIVE_RULE_PROFILE_INVALID" });
    }
  });

export type PublicLiveAnalysisSnapshot = z.infer<typeof PublicLiveAnalysisSnapshotSchema>;

export type SyntheticInteraction = Readonly<{
  artifactId: string;
  text: string;
  paymentRequestedAt: string;
  firstInPersonViewingAt: string;
}>;

export type LiveAnalysisFailureCode =
  | "ANALYSIS_PROVIDER_REFUSED"
  | "ANALYSIS_PROVIDER_INCOMPLETE"
  | "ANALYSIS_PROVIDER_SCHEMA_INVALID"
  | "ANALYSIS_PROVIDER_AUTH_FAILED"
  | "ANALYSIS_PROVIDER_RATE_LIMITED"
  | "ANALYSIS_LOCATOR_INVALID"
  | "ANALYSIS_PROVIDER_UNAVAILABLE"
  | "ANALYSIS_BUDGET_EXCEEDED"
  | "ANALYSIS_BUDGET_USAGE_UNKNOWN"
  | "ANALYSIS_DETERMINISTIC_COMPOSE_FAILED";
