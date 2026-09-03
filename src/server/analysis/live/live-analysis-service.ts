import { createHash, randomUUID } from "node:crypto";
import { OpenAIAnalysisError } from "@/adapters/openai/analysis/adapter";
import type {
  TerraAnalysisInput,
  TerraAnalysisOutput,
  TerraAnalysisSuccess,
} from "@/adapters/openai/analysis/contracts";
import type { EvidenceBudgetRepository } from "@/application/analysis-budget";
import { compareClaim } from "@/domain/evidence/claim-comparison";
import type { Claim, ContractClause, NormalizedValue, Observation } from "@/domain/evidence-graph";
import { evaluateFrs001 } from "@/domain/fraud/frs-001";
import { evaluateNonNaturalDeathDisclosure } from "@/domain/non-natural-death-disclosure";
import type { PrivateUploadRecord } from "@/server/uploads/contracts";
import { officialRuleIdsForProfile, type OfficialRuleProfile } from "@/domain/official-rules";
import {
  LIVE_TERRA_STAGE_ORDER,
  PublicLiveAnalysisSnapshotSchema,
  type LiveAnalysisFailureCode,
  type PublicLiveAnalysisSnapshot,
  type SyntheticInteraction,
} from "./contracts";

export interface TerraAnalyzer {
  analyze(input: unknown): Promise<TerraAnalysisSuccess>;
}

export interface LiveSnapshotRepository {
  commit(caseId: string, snapshot: PublicLiveAnalysisSnapshot): Promise<void>;
}

type Dependencies = Readonly<{
  analyzer: TerraAnalyzer;
  budget: EvidenceBudgetRepository;
  snapshots: LiveSnapshotRepository;
  nextId?: () => string;
}>;

export type RunLiveAnalysisResult =
  | Readonly<{ ok: true; snapshot: PublicLiveAnalysisSnapshot }>
  | Readonly<{ ok: false; code: LiveAnalysisFailureCode }>;

const reservationMaximums = {
  "listing.extract": { input: 20_000, output: 12_000 },
  "evidence.extract": { input: 200_000, output: 12_000 },
  "contract.extract": { input: 200_000, output: 12_000 },
  "interaction.extract": { input: 20_000, output: 12_000 },
} as const;

export class LiveAnalysisService {
  readonly #nextId: () => string;

  constructor(private readonly dependencies: Dependencies) {
    this.#nextId = dependencies.nextId ?? randomUUID;
  }

  async run(input: {
    caseId: "golden-v1";
    manifestHash: string;
    receipts: readonly PrivateUploadRecord[];
    interaction: SyntheticInteraction;
    ruleProfile?: OfficialRuleProfile;
  }): Promise<RunLiveAnalysisResult> {
    const modelInputs = buildModelInputs(input);
    const budgetCaseId = `case_${input.caseId.replaceAll("-", "_")}_00000001`;
    const outputs = new Map<(typeof LIVE_TERRA_STAGE_ORDER)[number], TerraAnalysisOutput>();
    const stageRuns: PublicLiveAnalysisSnapshot["stageRuns"] = [];

    for (const stage of LIVE_TERRA_STAGE_ORDER) {
      const maximum = reservationMaximums[stage];
      const reservationId = this.#nextId();
      const reserved = await this.dependencies.budget.reserve({
        operationKind: "provider_request",
        caseId: budgetCaseId,
        reservationId,
        model: "gpt-5.6-terra",
        maximumProviderAttempts: 1,
        maximumInputTokens: maximum.input,
        maximumOutputAndReasoningTokens: maximum.output,
      });
      if (!reserved.ok) {
        return {
          ok: false,
          code:
            reserved.code === "EVIDENCE_BUDGET_USAGE_UNKNOWN"
              ? "ANALYSIS_BUDGET_USAGE_UNKNOWN"
              : "ANALYSIS_BUDGET_EXCEEDED",
        };
      }
      if (!reserved.metered) return { ok: false, code: "ANALYSIS_BUDGET_EXCEEDED" };

      let result: TerraAnalysisSuccess;
      try {
        result = await this.dependencies.analyzer.analyze(modelInputs[stage]);
      } catch (error) {
        if (!(error instanceof OpenAIAnalysisError)) {
          const issueSummary =
            typeof error === "object" &&
            error !== null &&
            "issues" in error &&
            Array.isArray(error.issues)
              ? error.issues
                  .slice(0, 8)
                  .map((issue) => {
                    if (typeof issue !== "object" || issue === null) return "unknown";
                    const record = issue as Record<string, unknown>;
                    return `${String(record["code"] ?? "unknown")}@${Array.isArray(record["path"]) ? record["path"].join(".") : "unknown"}`;
                  })
                  .join(",")
              : "none";
          if (process.env["NODE_ENV"] !== "test") {
            process.stderr.write(
              `ANALYSIS_LOCAL_FAILURE stage=${stage} name=${error instanceof Error ? error.name : "unknown"} issues=${issueSummary}\n`,
            );
          }
        }
        const failure =
          error instanceof OpenAIAnalysisError
            ? error
            : new OpenAIAnalysisError("ANALYSIS_PROVIDER_UNAVAILABLE", 1, null);
        if (process.env["NODE_ENV"] !== "test") {
          process.stderr.write(
            `ANALYSIS_PROVIDER_FAILURE stage=${stage} reason=${failure.code} status=${failure.providerStatus ?? "unknown"} providerCode=${failure.providerErrorCode ?? "unknown"}\n`,
          );
        }
        await this.dependencies.budget.reconcile({
          reservationId,
          usage: { kind: "unknown", actualProviderAttempts: Math.max(1, failure.providerAttempts) },
        });
        return { ok: false, code: failure.code };
      }

      const usage = result.provenance.usage;
      const reconciled = await this.dependencies.budget.reconcile({
        reservationId,
        usage: usage.known
          ? {
              kind: "known",
              actualProviderAttempts: result.provenance.providerAttempts,
              inputTokens: usage.inputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              outputTokens: usage.outputTokens,
              reasoningTokens: usage.reasoningTokens,
            }
          : {
              kind: "unknown",
              actualProviderAttempts: result.provenance.providerAttempts,
            },
      });
      if (!reconciled.ok || reconciled.exceededReservation) {
        return {
          ok: false,
          code: usage.known ? "ANALYSIS_BUDGET_EXCEEDED" : "ANALYSIS_BUDGET_USAGE_UNKNOWN",
        };
      }
      outputs.set(stage, result.output);
      stageRuns.push({
        stage,
        status: "succeeded",
        outputHash: sha256(result.output),
        providerRequestId: result.provenance.providerRequestId,
        providerAttempts: result.provenance.providerAttempts,
        requestedModel: result.provenance.requestedModel,
        resolvedModel: result.provenance.resolvedModel,
        reasoningEffort: result.provenance.reasoningEffort,
        requestedServiceTier: result.provenance.requestedServiceTier,
        resolvedServiceTier: result.provenance.resolvedServiceTier,
        promptVersion: result.provenance.promptVersion,
        schemaVersion: result.provenance.schemaVersion,
        usage: result.provenance.usage,
      });
    }

    try {
      const budget = await this.dependencies.budget.get(budgetCaseId);
      if (budget === null) throw new Error("BUDGET_MISSING");
      const ruleProfile = input.ruleProfile ?? "p0";
      const composed = composeDeterministic(outputs, input.interaction, ruleProfile);
      const snapshot = PublicLiveAnalysisSnapshotSchema.parse({
        schemaVersion: "rentproof.live-analysis-snapshot.v1",
        snapshotId: `snapshot_live_${sha256({ stageRuns, manifestHash: input.manifestHash }).slice(0, 24)}`,
        caseVersion: input.caseId,
        manifestHash: input.manifestHash,
        executionMode: "live",
        providerCalled: true,
        ruleProfile,
        stageRuns,
        budget: {
          providerAttempts: budget.actual.providerAttempts,
          inputTokens: budget.actual.inputTokens,
          outputAndReasoningTokens: budget.actual.outputAndReasoningTokens,
          cachedInputTokens: budget.actualCachedInputTokens,
          engineeringAlertReached: budget.engineeringAlertReached,
          usageKnown: !budget.unknownUsage,
        },
        configurationWarnings: ["OPENAI_PROJECT_LIMITS_UNVERIFIED"],
        ...composed,
        reportHref: "/reports/golden-v1",
      });
      await this.dependencies.snapshots.commit(input.caseId, snapshot);
      return { ok: true, snapshot };
    } catch {
      return { ok: false, code: "ANALYSIS_DETERMINISTIC_COMPOSE_FAILED" };
    }
  }
}

function buildModelInputs(input: {
  caseId: "golden-v1";
  receipts: readonly PrivateUploadRecord[];
  interaction: SyntheticInteraction;
}): Record<(typeof LIVE_TERRA_STAGE_ORDER)[number], TerraAnalysisInput> {
  const modelCaseId = `case_${input.caseId.replaceAll("-", "_")}_00000001`;
  const listing = requiredReceipt(input.receipts, "listing", "image");
  const viewing = input.receipts.filter(
    (record) =>
      (record.receipt.kind === "viewing" || record.receipt.kind === "follow_up") &&
      record.privatePayload.type === "image",
  );
  const contract = requiredReceipt(input.receipts, "contract", "pdf");
  if (viewing.length === 0 || viewing.length > 12) throw new Error("VIEWING_RECEIPT_INVALID");

  return {
    "listing.extract": {
      stage: "listing.extract",
      caseId: modelCaseId,
      artifact: {
        kind: "image",
        image: imageInput(listing),
      },
    },
    "evidence.extract": {
      stage: "evidence.extract",
      caseId: modelCaseId,
      images: viewing.map(imageInput),
    },
    "contract.extract": {
      stage: "contract.extract",
      caseId: modelCaseId,
      artifactId: modelArtifactId(contract.artifactId),
      pages:
        contract.privatePayload.type === "pdf"
          ? contract.privatePayload.extracted.pages.map((page) => ({
              page: page.page,
              text: page.text,
            }))
          : [],
    },
    "interaction.extract": {
      stage: "interaction.extract",
      caseId: modelCaseId,
      artifactId: modelArtifactId(input.interaction.artifactId),
      synthetic: true,
      text: input.interaction.text,
    },
  };
}

function requiredReceipt(
  receipts: readonly PrivateUploadRecord[],
  kind: "listing" | "contract",
  payloadType: "image" | "pdf",
): PrivateUploadRecord {
  const matches = receipts.filter(
    (record) => record.receipt.kind === kind && record.privatePayload.type === payloadType,
  );
  if (matches.length !== 1) throw new Error("REQUIRED_RECEIPT_INVALID");
  const match = matches[0];
  if (match === undefined) throw new Error("REQUIRED_RECEIPT_INVALID");
  return match;
}

function imageInput(record: PrivateUploadRecord) {
  if (record.privatePayload.type !== "image" || record.receipt.media.type !== "image") {
    throw new Error("IMAGE_RECEIPT_INVALID");
  }
  return {
    artifactId: modelArtifactId(record.artifactId),
    mime: record.receipt.media.mime,
    base64: Buffer.from(record.privatePayload.derivativeBytes).toString("base64"),
  };
}

function modelArtifactId(artifactId: string): string {
  return artifactId.length >= 20 ? artifactId : `artifact_${artifactId}_0001`;
}

function composeDeterministic(
  outputs: ReadonlyMap<(typeof LIVE_TERRA_STAGE_ORDER)[number], TerraAnalysisOutput>,
  interaction: SyntheticInteraction,
  ruleProfile: OfficialRuleProfile,
) {
  const listing = outputFor(outputs, "listing.extract");
  const evidence = outputFor(outputs, "evidence.extract");
  const contract = outputFor(outputs, "contract.extract");
  const interactionOutput = outputFor(outputs, "interaction.extract");
  if (
    listing.stage !== "listing.extract" ||
    evidence.stage !== "evidence.extract" ||
    contract.stage !== "contract.extract" ||
    interactionOutput.stage !== "interaction.extract"
  ) {
    throw new Error("STAGE_OUTPUT_MISMATCH");
  }

  const findings = listing.claims.map((claim) =>
    deterministicFinding(claim, evidence.observations, contract.clauses),
  );
  const contractSource = contract.clauses.at(0)?.locator.locatorId ?? contract.clauses.at(0)?.id;
  if (contractSource === undefined) throw new Error("CONTRACT_LOCATOR_REQUIRED");
  const ruleChecks = officialRuleIdsForProfile(ruleProfile).map((ruleId) => {
    const subsidyRestriction =
      ruleId === "RP-010" &&
      contract.clauses.some(
        (clause) =>
          clause.semanticKey.includes("subsid") &&
          clause.normalizedValue?.type === "boolean" &&
          clause.normalizedValue.value === false,
      );
    return {
      ruleId,
      result: subsidyRestriction
        ? ("possible_difference" as const)
        : ("missing_information" as const),
      reasonCode: subsidyRestriction ? "RENT_SUBSIDY_RESTRICTION_TEXT" : p1MissingReason(ruleId),
      sourceRefs: [contractSource],
    };
  });
  const cue = interactionOutput.paymentRequestCues.at(0);
  const fraud = evaluateFrs001({
    paymentRequestEvidence:
      cue === undefined ? { present: false } : { present: true, locatorId: cue.locator.locatorId },
    paymentRequestedAt: { status: "known", value: interaction.paymentRequestedAt },
    firstInPersonViewingAt: { status: "known", value: interaction.firstInPersonViewingAt },
  });
  const nextActions = [
    ...findings
      .filter((finding) => finding.status !== "supported")
      .slice(0, 3)
      .map((finding) => `簽約前確認 ${finding.claimId}，並把結果寫入契約附件。`),
    fraud.status === "detected"
      ? "付款前停止並查證付款要求、出租方身分與首次實地看屋安排。"
      : "付款前再次核對付款要求與實地看屋時間線。",
  ];
  return {
    findings,
    ruleChecks,
    fraudSignals: [
      {
        signalId: fraud.signalId,
        status: fraud.status,
        action: fraud.action,
        reasonCode: fraud.reasonCode,
        sourceRefs: fraud.evidenceRefs,
      },
    ],
    nonNaturalDeathDisclosure: evaluateNonNaturalDeathDisclosure({
      statements: contract.nonNaturalDeathDisclosureStatements,
    }),
    nextActions,
  };
}

function p1MissingReason(ruleId: string): string {
  if (ruleId === "RP-001") return "REVIEW_PERIOD_INFORMATION_MISSING";
  if (ruleId === "RP-002") return "ADVERTISEMENT_EXCLUSION_INFORMATION_MISSING";
  if (ruleId === "RP-005") return "DEPOSIT_OR_RETURN_TERMS_MISSING";
  if (ruleId === "RP-007") return "NON_METERED_OR_PUBLIC_ELECTRICITY_INFORMATION_MISSING";
  return "DETERMINISTIC_RULE_INPUT_INCOMPLETE";
}

export function deterministicFinding(
  claim: Claim,
  observations: readonly Observation[],
  clauses: readonly ContractClause[],
) {
  const candidates = [
    ...observations
      .filter((item) => item.key === claim.key)
      .map((item) => ({
        entity: item,
        value: item.observedValue,
        shown: item.presence === "observed",
      })),
    ...clauses
      .filter((item) => item.semanticKey === claim.key)
      .map((item) => ({ entity: item, value: item.normalizedValue, shown: true })),
  ];
  const comparable = candidates.map((candidate) => ({
    coverage: candidate.shown ? ("complete" as const) : ("not_shown" as const),
    locatorValid: true,
    quality:
      candidate.entity.qualityFlags.length === 0 &&
      (candidate.entity.modelConfidence === null || candidate.entity.modelConfidence >= 0.7)
        ? ("sufficient" as const)
        : ("low_confidence" as const),
    relation:
      candidate.value === null
        ? ("not_mentioned" as const)
        : comparableRelation(candidate.value, claim.normalizedValue),
  }));
  const status = compareClaim(comparable);
  const refs = candidates.map((candidate) => candidate.entity.locator.locatorId);
  return {
    claimId: claim.id,
    status,
    sourceRefs: refs.length > 0 ? refs.slice(0, 8) : [claim.locator.locatorId],
  };
}

function comparableRelation(
  left: NormalizedValue,
  right: NormalizedValue,
): "same" | "opposite" | "not_mentioned" {
  if (left.type !== right.type) return "not_mentioned";
  if (left.type === "text" || right.type === "text") {
    return left.type === "text" && right.type === "text" && left.value === right.value
      ? "same"
      : "not_mentioned";
  }
  if (left.type === "money" && right.type === "money") {
    if (left.currency !== right.currency || left.period !== right.period) return "not_mentioned";
    return left.amountMinor === right.amountMinor ? "same" : "opposite";
  }
  if (left.type === "unit_rate" && right.type === "unit_rate") {
    if (left.currency !== right.currency || left.unit !== right.unit) return "not_mentioned";
    return left.amountMinorPerUnit === right.amountMinorPerUnit ? "same" : "opposite";
  }
  if (left.type === "boolean" && right.type === "boolean") {
    return left.value === right.value ? "same" : "opposite";
  }
  return "not_mentioned";
}

function outputFor(
  outputs: ReadonlyMap<(typeof LIVE_TERRA_STAGE_ORDER)[number], TerraAnalysisOutput>,
  stage: (typeof LIVE_TERRA_STAGE_ORDER)[number],
): TerraAnalysisOutput {
  const output = outputs.get(stage);
  if (output === undefined) throw new Error("STAGE_OUTPUT_MISSING");
  return output;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export class InMemoryLiveSnapshotRepository implements LiveSnapshotRepository {
  readonly #snapshots = new Map<string, PublicLiveAnalysisSnapshot>();

  commit(caseId: string, snapshot: PublicLiveAnalysisSnapshot): Promise<void> {
    this.#snapshots.set(caseId, structuredClone(snapshot));
    return Promise.resolve();
  }

  get(caseId: string): PublicLiveAnalysisSnapshot | null {
    const snapshot = this.#snapshots.get(caseId);
    return snapshot === undefined ? null : structuredClone(snapshot);
  }
}
