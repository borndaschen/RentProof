import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  createOpenAITerraAnalysisAdapter,
  OpenAIAnalysisError,
} from "@/adapters/openai/analysis/adapter";
import type {
  TerraAnalysisInput,
  TerraAnalysisOutput,
  TerraAnalysisSuccess,
} from "@/adapters/openai/analysis/contracts";
import {
  InMemoryEvidenceBudgetRepository,
  type EvidenceBudgetRepository,
} from "@/application/analysis-budget";
import type { ActorContext } from "@/application/repositories";
import {
  RealAnalysisSnapshotSchema,
  type RealArtifactAnalysisPayload,
  type RealDemoService,
} from "@/application/real-demo";
import { officialRuleIdsForProfile } from "@/domain/official-rules";
import { deterministicFinding } from "@/server/analysis/live/live-analysis-service";
import { getRealDemoRuntime } from "./runtime";

const stages = ["listing.extract", "evidence.extract", "contract.extract"] as const;
const budget = new InMemoryEvidenceBudgetRepository({ now: () => new Date() });
const ExtractedContractSchema = z
  .object({
    pages: z
      .array(
        z
          .object({ page: z.number().int().min(1).max(30), text: z.string().max(300_000) })
          .passthrough(),
      )
      .min(1)
      .max(30),
  })
  .passthrough()
  .superRefine((value, context) => {
    const pageNumbers = value.pages.map((page) => page.page);
    if (new Set(pageNumbers).size !== pageNumbers.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_PDF_PAGE" });
    }
    const totalCharacters = value.pages.reduce((sum, page) => sum + [...page.text].length, 0);
    if (totalCharacters > 300_000) {
      context.addIssue({ code: "custom", message: "PDF_TEXT_LIMIT_EXCEEDED" });
    }
  });

export async function analyzeRealCase(input: {
  actor: ActorContext;
  caseId: string;
  apiKey: string;
}) {
  const runtime = await getRealDemoRuntime();
  return runRealCaseAnalysis(input, {
    service: runtime.service,
    analyzer: createOpenAITerraAnalysisAdapter(input.apiKey),
    budget,
    nextId: () => randomBytes(24).toString("hex"),
    now: () => new Date(),
  });
}

export async function runRealCaseAnalysis(
  input: {
    actor: ActorContext;
    caseId: string;
  },
  dependencies: {
    service: Pick<RealDemoService, "loadAnalysisPayloads" | "commitAnalysis">;
    analyzer: { analyze(input: unknown): Promise<TerraAnalysisSuccess> };
    budget: EvidenceBudgetRepository;
    nextId: () => string;
    now: () => Date;
  },
) {
  const artifacts = await dependencies.service.loadAnalysisPayloads(input.actor, input.caseId);
  const modelInputs = buildInputs(input.caseId, artifacts);
  const outputs = new Map<(typeof stages)[number], TerraAnalysisOutput>();
  const stageSummaries: Array<{
    stage: (typeof stages)[number];
    model: string;
    promptVersion: string;
    requestedServiceTier: "default";
    usageKnown: boolean;
  }> = [];

  for (const stage of stages) {
    const reservationId = `reservation_${dependencies.nextId()}`;
    const reserved = await dependencies.budget.reserve({
      operationKind: "provider_request",
      caseId: input.caseId,
      reservationId,
      model: "gpt-5.6-terra",
      maximumProviderAttempts: 1,
      maximumInputTokens: stage === "listing.extract" ? 20_000 : 200_000,
      maximumOutputAndReasoningTokens: 12_000,
    });
    if (!reserved.ok || !reserved.metered) throw new Error("REAL_ANALYSIS_BUDGET_EXCEEDED");
    let result: TerraAnalysisSuccess;
    try {
      result = await dependencies.analyzer.analyze(modelInputs[stage]);
    } catch (error) {
      const attempts = error instanceof OpenAIAnalysisError ? error.providerAttempts : 1;
      await dependencies.budget.reconcile({
        reservationId,
        usage: { kind: "unknown", actualProviderAttempts: Math.max(1, attempts) },
      });
      throw error;
    }
    const usage = result.provenance.usage;
    const reconciled = await dependencies.budget.reconcile({
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
        : { kind: "unknown", actualProviderAttempts: result.provenance.providerAttempts },
    });
    if (!reconciled.ok || reconciled.exceededReservation || !usage.known) {
      throw new Error("REAL_ANALYSIS_BUDGET_USAGE_UNKNOWN");
    }
    outputs.set(stage, result.output);
    stageSummaries.push({
      stage,
      model: result.provenance.resolvedModel,
      promptVersion: result.provenance.promptVersion,
      requestedServiceTier: "default",
      usageKnown: true,
    });
  }

  const listing = outputFor(outputs, "listing.extract");
  const evidence = outputFor(outputs, "evidence.extract");
  const contract = outputFor(outputs, "contract.extract");
  if (
    listing.stage !== "listing.extract" ||
    evidence.stage !== "evidence.extract" ||
    contract.stage !== "contract.extract"
  ) {
    throw new Error("REAL_ANALYSIS_STAGE_MISMATCH");
  }
  const findings = listing.claims.map((claim) => ({
    ...deterministicFinding(claim, evidence.observations, contract.clauses),
    key: claim.key,
  }));
  const subsidyDifference = contract.clauses.some(
    (clause) =>
      clause.semanticKey.includes("subsid") &&
      clause.normalizedValue?.type === "boolean" &&
      clause.normalizedValue.value === false,
  );
  const nextActions = findings
    .filter((finding) => finding.status !== "supported")
    .slice(0, 3)
    .map((finding) => `簽約前確認「${finding.key}」，並把結果寫入契約或附件。`);
  if (nextActions.length === 0) nextActions.push("簽約前再次核對設備、費用與契約附件。");
  const artifactSetHash = createHash("sha256")
    .update(
      artifacts
        .map((artifact) => artifact.artifactId)
        .sort()
        .join("\n"),
      "utf8",
    )
    .digest("hex");
  const snapshot = RealAnalysisSnapshotSchema.parse({
    schemaVersion: "rentproof.real-analysis-snapshot.v1",
    snapshotId: `snapshot_${dependencies.nextId()}`,
    caseId: input.caseId,
    artifactSetHash,
    findings,
    stages: stageSummaries,
    ruleSummary: {
      profile: "p1",
      checked: officialRuleIdsForProfile("p1").length,
      possibleDifference: subsidyDifference ? 1 : 0,
      missingInformation: subsidyDifference ? 9 : 10,
    },
    nextActions,
    createdAt: dependencies.now().toISOString(),
  });
  await dependencies.service.commitAnalysis(input.actor, input.caseId, snapshot);
  return snapshot;
}

function buildInputs(
  caseId: string,
  artifacts: readonly RealArtifactAnalysisPayload[],
): Record<(typeof stages)[number], TerraAnalysisInput> {
  const listing = artifacts.find((artifact) => artifact.kind === "listing_image");
  const contract = artifacts.find((artifact) => artifact.kind === "contract_pdf");
  const viewing = artifacts.filter(
    (artifact) => artifact.kind === "viewing_image" || artifact.kind === "follow_up_image",
  );
  if (!listing || !contract || viewing.length === 0) {
    throw new Error("REAL_DEMO_ARTIFACT_SET_INCOMPLETE");
  }
  let parsedContract: z.infer<typeof ExtractedContractSchema>;
  try {
    parsedContract = ExtractedContractSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contract.bytes)) as unknown,
    );
  } catch {
    throw new Error("REAL_ANALYSIS_ARTIFACT_INVALID");
  }
  const image = (artifact: RealArtifactAnalysisPayload) => ({
    artifactId: artifact.artifactId,
    mime: artifact.mime === "image/png" ? ("image/png" as const) : ("image/jpeg" as const),
    base64: Buffer.from(artifact.bytes).toString("base64"),
  });
  return {
    "listing.extract": {
      stage: "listing.extract",
      caseId,
      artifact: { kind: "image", image: image(listing) },
    },
    "evidence.extract": {
      stage: "evidence.extract",
      caseId,
      images: viewing.map(image),
    },
    "contract.extract": {
      stage: "contract.extract",
      caseId,
      artifactId: contract.artifactId,
      pages: parsedContract.pages.map((page) => ({ page: page.page, text: page.text })),
    },
  };
}

function outputFor(
  outputs: ReadonlyMap<(typeof stages)[number], TerraAnalysisOutput>,
  stage: (typeof stages)[number],
): TerraAnalysisOutput {
  const output = outputs.get(stage);
  if (!output) throw new Error("REAL_ANALYSIS_STAGE_MISSING");
  return output;
}
