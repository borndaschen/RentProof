import {
  AnalysisSnapshotSchema,
  AnalyzePipelineCommandSchema,
  PipelineRunSchema,
  StageProvenanceSchema,
  StageRunSchema,
} from "./contracts";
import type {
  AnalysisSnapshot,
  AnalyzePipelineCommand,
  PipelineRun,
  StageConfiguration,
  StageProvenance,
  StageRun,
} from "./contracts";
import { PIPELINE_STAGE_DEPENDENCIES, PIPELINE_STAGE_ORDER } from "./dag";
import type { PipelineStageId } from "./dag";
import type {
  OwnerGate,
  PipelineClock,
  PipelineRepository,
  PolicyGate,
  StageExecutionResult,
  StageExecutor,
  StageRunIdGenerator,
  UploadGate,
} from "./ports";
import { StageExecutionResultSchema } from "./ports";
import { createStageKey, sha256Canonical } from "./stage-key";

export type AnalyzePipelineResult =
  | Readonly<{ ok: true; pipelineRun: PipelineRun; snapshot: AnalysisSnapshot }>
  | Readonly<{
      ok: false;
      code:
        | "OWNER_GATE_REJECTED"
        | "POLICY_GATE_REJECTED"
        | "UPLOAD_GATE_REJECTED"
        | "CASE_REVISION_CHANGED"
        | "STAGE_ALREADY_RUNNING"
        | "STAGE_FAILED";
      pipelineRun: PipelineRun | null;
    }>;

type OrchestratorDependencies = Readonly<{
  repository: PipelineRepository;
  executor: StageExecutor;
  ownerGate: OwnerGate;
  policyGate: PolicyGate;
  uploadGate: UploadGate;
  clock: PipelineClock;
  idGenerator: StageRunIdGenerator;
}>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function createProvenance(
  configuration: StageConfiguration,
  sourceRefs: readonly string[],
  execution: StageExecutionResult,
): StageProvenance {
  const hasModel = configuration.requestedModel !== null;
  const provenance = {
    provenanceVersion: "rentproof.stage-provenance.v1" as const,
    algorithmVersion: configuration.algorithmVersion,
    promptVersion: configuration.promptVersion,
    schemaVersion: configuration.schemaVersion,
    rulesetVersion: configuration.rulesetVersion,
    model: hasModel
      ? {
          requested: configuration.requestedModel,
          resolved: execution.resolvedModel,
          reasoningEffort: configuration.reasoningEffort,
        }
      : null,
    serviceTier: hasModel
      ? {
          requested: configuration.requestedServiceTier,
          resolved: execution.resolvedServiceTier,
        }
      : null,
    sourceRefs: uniqueSorted(sourceRefs),
  };
  return StageProvenanceSchema.parse(provenance);
}

function createRunningPipeline(command: AnalyzePipelineCommand): PipelineRun {
  return PipelineRunSchema.parse({
    id: command.pipelineRunId,
    caseId: command.caseId,
    baseCaseRevision: command.baseCaseRevision,
    executionMode: command.executionMode,
    status: "running",
    stageRunIds: [],
    snapshotId: null,
    errorCode: null,
    startedAt: command.startedAt,
    completedAt: null,
  });
}

export class StageOrchestrator {
  constructor(private readonly dependencies: OrchestratorDependencies) {}

  async analyze(rawCommand: unknown): Promise<AnalyzePipelineResult> {
    const command = AnalyzePipelineCommandSchema.parse(rawCommand);

    if (!(await this.dependencies.ownerGate.verifyOwner(command.caseId)).ok) {
      return { ok: false, code: "OWNER_GATE_REJECTED", pipelineRun: null };
    }
    if (!(await this.dependencies.policyGate.verifyPolicy(command.caseId)).ok) {
      return { ok: false, code: "POLICY_GATE_REJECTED", pipelineRun: null };
    }
    if (!(await this.dependencies.uploadGate.verifyUploads(command.caseId)).ok) {
      return { ok: false, code: "UPLOAD_GATE_REJECTED", pipelineRun: null };
    }

    const currentRevision = await this.dependencies.repository.getCaseRevision(command.caseId);
    if (currentRevision !== command.baseCaseRevision) {
      return { ok: false, code: "CASE_REVISION_CHANGED", pipelineRun: null };
    }

    let pipelineRun = createRunningPipeline(command);
    await this.dependencies.repository.createPipelineRun(pipelineRun);
    const successfulRuns = new Map<PipelineStageId, StageRun>();

    for (const stageId of PIPELINE_STAGE_ORDER) {
      const dependencies = PIPELINE_STAGE_DEPENDENCIES[stageId].map((dependencyId) => {
        const dependency = successfulRuns.get(dependencyId);
        if (dependency === undefined) throw new Error("PIPELINE_DEPENDENCY_NOT_SUCCEEDED");
        return dependency;
      });
      const stageInput = command.stageInputs[stageId];
      const configuration = command.stageConfigurations[stageId];
      const dependencyOutputHashes = dependencies.map((run) => {
        if (run.outputHash === null) throw new Error("PIPELINE_DEPENDENCY_OUTPUT_MISSING");
        return run.outputHash;
      });
      const key = createStageKey({
        caseId: command.caseId,
        executionMode: command.executionMode,
        stageId,
        directInputHash: stageInput.directInputHash,
        dependencyOutputHashes,
        configuration,
      });
      const claim = await this.dependencies.repository.claimStageKey(key.stageRunKey);

      if (claim.kind === "cached") {
        successfulRuns.set(stageId, claim.stageRun);
        pipelineRun = PipelineRunSchema.parse({
          ...pipelineRun,
          stageRunIds: [...pipelineRun.stageRunIds, claim.stageRun.id],
        });
        continue;
      }
      if (claim.kind === "running") {
        return this.#failPipeline(pipelineRun, "STAGE_ALREADY_RUNNING");
      }

      const dependencyOutputRefs = dependencies.flatMap((run) => run.outputRefs);
      const sourceRefs = uniqueSorted([...stageInput.sourceRefs, ...dependencyOutputRefs]);
      let execution: StageExecutionResult;
      try {
        execution = StageExecutionResultSchema.parse(
          await this.dependencies.executor.execute({
            caseId: command.caseId,
            stageId,
            executionMode: command.executionMode,
            configuration,
            directSourceRefs: stageInput.sourceRefs,
            dependencyOutputRefs,
          }),
        );
      } catch {
        execution = {
          ok: false,
          code: "STAGE_EXECUTOR_FAILED",
          resolvedModel: null,
          resolvedServiceTier: null,
          providerRequestId: null,
        };
      }

      if (
        execution.ok &&
        ((configuration.requestedModel !== null &&
          (execution.resolvedModel === null || execution.resolvedServiceTier === null)) ||
          (configuration.requestedModel === null &&
            (execution.resolvedModel !== null || execution.resolvedServiceTier !== null)))
      ) {
        execution = {
          ok: false,
          code: "PROVIDER_SCHEMA_INVALID",
          resolvedModel: execution.resolvedModel,
          resolvedServiceTier: execution.resolvedServiceTier,
          providerRequestId: execution.providerRequestId,
        };
      }

      const provenance = createProvenance(configuration, sourceRefs, execution);
      const completedAt = this.dependencies.clock.now().toISOString();
      const stageRunId = this.dependencies.idGenerator.nextStageRunId(stageId, claim.attempt);
      const stageRun = StageRunSchema.parse({
        id: stageRunId,
        pipelineRunId: pipelineRun.id,
        caseId: command.caseId,
        stageId,
        stageRunKey: key.stageRunKey,
        directInputHash: stageInput.directInputHash,
        dependencyHash: key.dependencyHash,
        configHash: key.configHash,
        attempt: claim.attempt,
        status: execution.ok ? "succeeded" : "failed",
        provenance,
        outputHash: execution.ok ? execution.outputHash : null,
        outputRefs: execution.ok ? execution.outputRefs : [],
        error: execution.ok
          ? null
          : { code: execution.code, providerRequestId: execution.providerRequestId },
        startedAt: command.startedAt,
        completedAt,
      });

      await this.dependencies.repository.appendStageRun(stageRun);
      await this.dependencies.repository.releaseStageKey(key.stageRunKey);
      pipelineRun = PipelineRunSchema.parse({
        ...pipelineRun,
        stageRunIds: [...pipelineRun.stageRunIds, stageRun.id],
      });

      if (stageRun.status === "failed") {
        return this.#failPipeline(pipelineRun, "STAGE_FAILED");
      }
      successfulRuns.set(stageId, stageRun);
    }

    const snapshot = this.#createSnapshot(command, successfulRuns);
    const committed = await this.dependencies.repository.commitSnapshot(
      snapshot,
      command.baseCaseRevision,
    );
    if (!committed) return this.#failPipeline(pipelineRun, "CASE_REVISION_CHANGED");

    pipelineRun = PipelineRunSchema.parse({
      ...pipelineRun,
      status: "succeeded",
      snapshotId: snapshot.id,
      errorCode: null,
      completedAt: this.dependencies.clock.now().toISOString(),
    });
    await this.dependencies.repository.savePipelineRun(pipelineRun);
    return { ok: true, pipelineRun, snapshot };
  }

  async #failPipeline(
    pipelineRun: PipelineRun,
    code: "CASE_REVISION_CHANGED" | "STAGE_ALREADY_RUNNING" | "STAGE_FAILED",
  ): Promise<AnalyzePipelineResult> {
    const failed = PipelineRunSchema.parse({
      ...pipelineRun,
      status: "failed",
      snapshotId: null,
      errorCode: code,
      completedAt: this.dependencies.clock.now().toISOString(),
    });
    await this.dependencies.repository.savePipelineRun(failed);
    return { ok: false, code, pipelineRun: failed };
  }

  #createSnapshot(
    command: AnalyzePipelineCommand,
    successfulRuns: ReadonlyMap<PipelineStageId, StageRun>,
  ): AnalysisSnapshot {
    const listing = this.#requiredRun(successfulRuns, "listing.extract");
    const evidence = this.#requiredRun(successfulRuns, "evidence.extract");
    const contract = this.#requiredRun(successfulRuns, "contract.extract");
    const report = this.#requiredRun(successfulRuns, "report.compose");
    const reportRef = report.outputRefs.at(0);
    if (reportRef === undefined) throw new Error("REPORT_OUTPUT_REF_MISSING");

    const snapshotBase = {
      id: command.snapshotId,
      pipelineRunId: command.pipelineRunId,
      caseId: command.caseId,
      caseRevision: command.baseCaseRevision,
      executionMode: command.executionMode,
      stageHeads: {
        "listing.extract": listing.id,
        "evidence.extract": evidence.id,
        "contract.extract": contract.id,
        "report.compose": report.id,
      },
      stageProvenance: {
        "listing.extract": listing.provenance,
        "evidence.extract": evidence.provenance,
        "contract.extract": contract.provenance,
        "report.compose": report.provenance,
      },
      sourceRefs: uniqueSorted(
        [listing, evidence, contract, report].flatMap((run) => run.provenance.sourceRefs),
      ),
      reportRef,
      createdAt: this.dependencies.clock.now().toISOString(),
    };
    return AnalysisSnapshotSchema.parse({
      ...snapshotBase,
      snapshotHash: sha256Canonical(snapshotBase),
    });
  }

  #requiredRun(
    successfulRuns: ReadonlyMap<PipelineStageId, StageRun>,
    stageId: PipelineStageId,
  ): StageRun {
    const run = successfulRuns.get(stageId);
    if (run === undefined || run.status !== "succeeded") {
      throw new Error("PIPELINE_STAGE_NOT_SUCCEEDED");
    }
    return run;
  }
}
