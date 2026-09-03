import { z } from "zod";
import {
  DecimalStringSchema,
  FixedMonthlyCostSchema,
  OneTimeCostSchema,
  TwdMoneySchema,
  UnitRateCostSchema,
} from "../costs";
import { FindingSchema, SourceLocatorSchema } from "../evidence-graph";
import { OfficialRuleCheckSchema, OfficialSourceReferenceSchema } from "../official-rules";
import {
  NonNaturalDeathDisclosureResultSchema,
  NonNaturalDeathDisclosureStatementSchema,
} from "../non-natural-death-disclosure";
import { ActionCardSchema } from "./action-card";

const ReferenceIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const ReportSourceSchema = z
  .object({
    refId: ReferenceIdSchema,
    locator: SourceLocatorSchema,
  })
  .strict()
  .superRefine((source, context) => {
    if (source.refId !== source.locator.locatorId) {
      context.addIssue({ code: "custom", message: "SOURCE_REF_LOCATOR_ID_MISMATCH" });
    }
  });

export const VerifiedRuleCheckInputSchema = z
  .object({
    check: OfficialRuleCheckSchema,
    sourceRefIds: z.array(ReferenceIdSchema).min(1).max(20),
  })
  .strict();

export const VerifiedFraudSignalInputSchema = z
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
    sourceRefIds: z.array(ReferenceIdSchema).min(1).max(20),
    missingInputs: z.array(z.string().min(1).max(128)).max(10),
    humanVerificationRequired: z.literal(true),
  })
  .strict();

const VariableCostSummarySchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().trim().min(1).max(120),
    formula: z
      .object({
        minorUnitsPerUnit: DecimalStringSchema,
        unit: UnitRateCostSchema.shape.rate.shape.unit,
      })
      .strict(),
    scenario: z.discriminatedUnion("status", [
      z.object({ status: z.literal("usage_required") }).strict(),
      z
        .object({
          status: z.literal("estimated"),
          usage: UnitRateCostSchema.shape.usage.unwrap(),
          exactMinorUnits: DecimalStringSchema,
        })
        .strict(),
    ]),
  })
  .strict();

export const ReportCostSummarySchema = z
  .object({
    fixedMonthly: z
      .object({ items: z.array(FixedMonthlyCostSchema), total: TwdMoneySchema })
      .strict(),
    variable: z.array(VariableCostSummarySchema),
    oneTime: z.object({ items: z.array(OneTimeCostSchema), total: TwdMoneySchema }).strict(),
    monthlyScenarioTotal: z.discriminatedUnion("status", [
      z.object({ status: z.literal("fixed_only"), amount: TwdMoneySchema }).strict(),
      z
        .object({
          status: z.literal("usage_required"),
          knownFixedAmount: TwdMoneySchema,
          missingUsageCostIds: z.array(z.string().min(1).max(128)).min(1),
        })
        .strict(),
      z
        .object({
          status: z.literal("estimated"),
          currency: z.literal("TWD"),
          exactMinorUnits: DecimalStringSchema,
        })
        .strict(),
    ]),
  })
  .strict();

export const CostSourceCoverageSchema = z
  .object({
    costId: z.string().min(1).max(128),
    sourceRefIds: z.array(ReferenceIdSchema).min(1).max(20),
  })
  .strict();

export const ReportProvenanceSchema = z
  .object({
    snapshotId: ReferenceIdSchema,
    snapshotHash: HashSchema,
    snapshotVersion: z.string().min(1).max(64),
    manifestVersion: z.string().regex(/^golden-v[1-9][0-9]*$/u),
    manifestHash: HashSchema,
    manifestSchema: z.literal("rentproof.demo-manifest.v1"),
  })
  .strict();

export const PreSigningReportInputSchema = z
  .object({
    provenance: ReportProvenanceSchema,
    sourceLocators: z.array(ReportSourceSchema).max(500),
    findings: z.array(FindingSchema).max(200),
    ruleChecks: z.array(VerifiedRuleCheckInputSchema).max(20),
    fraudSignals: z.array(VerifiedFraudSignalInputSchema).max(20),
    nonNaturalDeathDisclosureStatements: z.array(NonNaturalDeathDisclosureStatementSchema).max(40),
    costSummary: ReportCostSummarySchema,
    costSourceCoverage: z.array(CostSourceCoverageSchema).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const sources = new Map(input.sourceLocators.map((source) => [source.refId, source.locator]));
    if (sources.size !== input.sourceLocators.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_SOURCE_REF" });
    }
    const requireRefs = (refs: readonly string[], path: (string | number)[]): void => {
      for (const ref of refs) {
        if (!sources.has(ref)) {
          context.addIssue({ code: "custom", message: "MISSING_SOURCE_LOCATOR", path });
        }
      }
    };

    input.findings.forEach((finding, findingIndex) => {
      finding.evidenceRefs.forEach((reference, referenceIndex) => {
        const registered = sources.get(reference.locator.locatorId);
        if (
          registered === undefined ||
          JSON.stringify(registered) !== JSON.stringify(reference.locator)
        ) {
          context.addIssue({
            code: "custom",
            message: "FINDING_LOCATOR_NOT_REGISTERED",
            path: ["findings", findingIndex, "evidenceRefs", referenceIndex],
          });
        }
      });
    });
    input.ruleChecks.forEach((rule, index) =>
      requireRefs(rule.sourceRefIds, ["ruleChecks", index, "sourceRefIds"]),
    );
    input.fraudSignals.forEach((signal, index) =>
      requireRefs(signal.sourceRefIds, ["fraudSignals", index, "sourceRefIds"]),
    );
    input.nonNaturalDeathDisclosureStatements.forEach((statement, index) => {
      if (statement.locator === undefined) return;
      const registered = sources.get(statement.locator.locatorId);
      if (
        registered === undefined ||
        JSON.stringify(registered) !== JSON.stringify(statement.locator)
      ) {
        context.addIssue({
          code: "custom",
          message: "NON_NATURAL_DEATH_LOCATOR_NOT_REGISTERED",
          path: ["nonNaturalDeathDisclosureStatements", index, "locator"],
        });
      }
    });

    const costIds = new Set([
      ...input.costSummary.fixedMonthly.items.map((item) => item.id),
      ...input.costSummary.variable.map((item) => item.id),
      ...input.costSummary.oneTime.items.map((item) => item.id),
    ]);
    const coveredCostIds = new Set<string>();
    input.costSourceCoverage.forEach((coverage, index) => {
      if (!costIds.has(coverage.costId) || coveredCostIds.has(coverage.costId)) {
        context.addIssue({
          code: "custom",
          message: "COST_SOURCE_COVERAGE_INVALID",
          path: ["costSourceCoverage", index],
        });
      }
      coveredCostIds.add(coverage.costId);
      requireRefs(coverage.sourceRefIds, ["costSourceCoverage", index, "sourceRefIds"]);
    });
    if (coveredCostIds.size !== costIds.size) {
      context.addIssue({ code: "custom", message: "COST_SOURCE_COVERAGE_INCOMPLETE" });
    }
  });

const FindingReportItemSchema = z
  .object({
    findingId: ReferenceIdSchema,
    status: z.enum(["supported", "contradicted", "insufficient_evidence"]),
    reasonCode: z.string().min(1).max(96),
    sourceRefs: z.array(ReferenceIdSchema).min(1).max(20),
  })
  .strict();

const RuleReportItemSchema = z
  .object({
    ruleId: z.string().min(1).max(32),
    result: z.enum(["no_difference_found", "possible_difference", "missing_information"]),
    reasonCode: z.string().min(1).max(96),
    sourceRefs: z.array(ReferenceIdSchema).min(1).max(20),
    officialSource: OfficialSourceReferenceSchema,
  })
  .strict();

const FraudReportItemSchema = z
  .object({
    signalId: z.literal("FRS-001"),
    status: z.enum([
      "payment_verification_required",
      "not_detected_in_provided_data",
      "insufficient_information",
    ]),
    reasonCode: z.string().min(1).max(96),
    sourceRefs: z.array(ReferenceIdSchema).min(1).max(20),
  })
  .strict();

export const PreSigningReportSchema = z
  .object({
    schema: z.literal("rentproof.pre-signing-report.v1"),
    provenance: ReportProvenanceSchema,
    sources: z.array(ReportSourceSchema),
    evidence: z
      .object({
        supported: z.array(FindingReportItemSchema),
        contradicted: z.array(FindingReportItemSchema),
        insufficientEvidence: z.array(FindingReportItemSchema),
      })
      .strict(),
    officialRules: z
      .object({
        noDifferenceFound: z.array(RuleReportItemSchema),
        possibleDifference: z.array(RuleReportItemSchema),
        missingInformation: z.array(RuleReportItemSchema),
      })
      .strict(),
    paymentVerification: z.array(FraudReportItemSchema),
    nonNaturalDeathDisclosure: NonNaturalDeathDisclosureResultSchema,
    costs: ReportCostSummarySchema,
    actions: z.array(ActionCardSchema),
  })
  .strict()
  .superRefine((report, context) => {
    const sources = new Map(report.sources.map((source) => [source.refId, source.locator]));
    report.nonNaturalDeathDisclosure.checks.forEach((check, checkIndex) => {
      check.sourceLocators.forEach((locator, locatorIndex) => {
        const registered = sources.get(locator.locatorId);
        if (registered === undefined || JSON.stringify(registered) !== JSON.stringify(locator)) {
          context.addIssue({
            code: "custom",
            message: "NON_NATURAL_DEATH_REPORT_LOCATOR_NOT_REGISTERED",
            path: [
              "nonNaturalDeathDisclosure",
              "checks",
              checkIndex,
              "sourceLocators",
              locatorIndex,
            ],
          });
        }
      });
    });
  });

export type PreSigningReportInput = z.infer<typeof PreSigningReportInputSchema>;
export type PreSigningReport = z.infer<typeof PreSigningReportSchema>;
