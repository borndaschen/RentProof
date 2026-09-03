import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AnalyzePipelineCommandSchema,
  PipelineRunSchema,
  StageConfigurationSchema,
  StageProvenanceSchema,
  StageRunSchema,
} from "./contracts";
import type { AnalyzePipelineCommand, StageConfiguration } from "./contracts";
import { PIPELINE_STAGE_ORDER } from "./dag";
import type { PipelineStageId } from "./dag";
import { InMemoryPipelineRepository } from "./in-memory-pipeline-repository";
import { StageOrchestrator } from "./orchestrator";
import type {
  ExecuteStageInput,
  GateResult,
  OwnerGate,
  PipelineClock,
  PolicyGate,
  StageExecutionResult,
  StageExecutor,
  StageRunIdGenerator,
  UploadGate,
} from "./ports";
import { createStageKey, sha256Canonical } from "./stage-key";

const caseId = "case_pipeline_opaque_0001";
const startedAt = "2026-09-02T06:00:00.000Z";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function id(prefix: string, sequence: number): string {
  return `${prefix}_opaque_${String(sequence).padStart(12, "0")}`;
}

function cloudConfiguration(stageId: PipelineStageId): StageConfiguration {
  return {
    algorithmVersion: `${stageId}.algorithm.v1`,
    promptVersion: `${stageId}.prompt.v1`,
    schemaVersion: `${stageId}.schema.v1`,
    rulesetVersion: null,
    requestedModel: "gpt-5.6-terra",
    reasoningEffort: "medium",
    requestedServiceTier: "default",
  };
}

function reportConfiguration(): StageConfiguration {
  return {
    algorithmVersion: "report.compose.algorithm.v1",
    promptVersion: null,
    schemaVersion: "report.compose.schema.v1",
    rulesetVersion: "official-rules.v1",
    requestedModel: null,
    reasoningEffort: null,
    requestedServiceTier: null,
  };
}

function command(sequence = 1): AnalyzePipelineCommand {
  return AnalyzePipelineCommandSchema.parse({
    pipelineRunId: id("pipeline", sequence),
    snapshotId: id("snapshot", sequence),
    caseId,
    baseCaseRevision: 7,
    executionMode: "fixture",
    startedAt,
    stageInputs: {
      "listing.extract": {
        directInputHash: hash("listing-input"),
        sourceRefs: [id("listing_source", 1)],
      },
      "evidence.extract": {
        directInputHash: hash("evidence-input"),
        sourceRefs: [id("image_source", 1)],
      },
      "contract.extract": {
        directInputHash: hash("contract-input"),
        sourceRefs: [id("contract_source", 1)],
      },
      "report.compose": {
        directInputHash: hash("report-input"),
        sourceRefs: [],
      },
    },
    stageConfigurations: {
      "listing.extract": cloudConfiguration("listing.extract"),
      "evidence.extract": cloudConfiguration("evidence.extract"),
      "contract.extract": cloudConfiguration("contract.extract"),
      "report.compose": reportConfiguration(),
    },
  });
}

class FixedClock implements PipelineClock {
  now(): Date {
    return new Date("2026-09-02T06:00:10.000Z");
  }
}

class SequentialIds implements StageRunIdGenerator {
  #sequence = 0;

  nextStageRunId(): string {
    this.#sequence += 1;
    return id("stage_run", this.#sequence);
  }
}

class RecordingGate implements OwnerGate, PolicyGate, UploadGate {
  constructor(
    private readonly name: "owner" | "policy" | "upload",
    private readonly calls: string[],
    private readonly allowed = true,
  ) {}

  verifyOwner(): Promise<GateResult> {
    return this.#verify("owner");
  }

  verifyPolicy(): Promise<GateResult> {
    return this.#verify("policy");
  }

  verifyUploads(): Promise<GateResult> {
    return this.#verify("upload");
  }

  #verify(expected: "owner" | "policy" | "upload"): Promise<GateResult> {
    if (this.name !== expected) throw new Error("WRONG_GATE_METHOD");
    this.calls.push(this.name);
    return Promise.resolve(this.allowed ? { ok: true } : { ok: false });
  }
}

class RecordingExecutor implements StageExecutor {
  readonly calls: PipelineStageId[] = [];

  constructor(
    private readonly behavior?: (
      input: ExecuteStageInput,
      callNumber: number,
    ) => StageExecutionResult | Promise<StageExecutionResult>,
  ) {}

  async execute(input: ExecuteStageInput): Promise<StageExecutionResult> {
    this.calls.push(input.stageId);
    if (this.behavior !== undefined) return this.behavior(input, this.calls.length);

    const configuration = input.configuration;
    return {
      ok: true,
      outputHash: hash(`${input.stageId}-output`),
      outputRefs: [id(`${input.stageId.replaceAll(".", "_")}_output`, 1)],
      resolvedModel: configuration.requestedModel,
      resolvedServiceTier: configuration.requestedServiceTier === null ? null : "default",
      providerRequestId:
        configuration.requestedModel === null ? null : `${input.stageId}-request-id`,
    };
  }
}

function createHarness(
  options?: Readonly<{
    owner?: boolean;
    policy?: boolean;
    upload?: boolean;
    executor?: RecordingExecutor;
  }>,
) {
  const repository = new InMemoryPipelineRepository();
  repository.setCaseRevision(caseId, 7);
  const gateCalls: string[] = [];
  const executor = options?.executor ?? new RecordingExecutor();
  const orchestrator = new StageOrchestrator({
    repository,
    executor,
    ownerGate: new RecordingGate("owner", gateCalls, options?.owner ?? true),
    policyGate: new RecordingGate("policy", gateCalls, options?.policy ?? true),
    uploadGate: new RecordingGate("upload", gateCalls, options?.upload ?? true),
    clock: new FixedClock(),
    idGenerator: new SequentialIds(),
  });
  return { repository, executor, orchestrator, gateCalls };
}

describe("StageOrchestrator", () => {
  it("executes only the fixed listing → evidence → contract → report DAG", async () => {
    const harness = createHarness();
    const result = await harness.orchestrator.analyze(command());

    expect(result.ok).toBe(true);
    expect(harness.gateCalls).toEqual(["owner", "policy", "upload"]);
    expect(harness.executor.calls).toEqual(PIPELINE_STAGE_ORDER);
    if (!result.ok) throw new Error("Expected pipeline success.");
    expect(result.pipelineRun.status).toBe("succeeded");
    expect(result.pipelineRun.stageRunIds).toHaveLength(4);
    expect(result.snapshot.stageProvenance["listing.extract"]).toMatchObject({
      promptVersion: "listing.extract.prompt.v1",
      schemaVersion: "listing.extract.schema.v1",
      rulesetVersion: null,
      model: {
        requested: "gpt-5.6-terra",
        resolved: "gpt-5.6-terra",
      },
      serviceTier: { requested: "default", resolved: "default" },
    });
    expect(result.snapshot.stageProvenance["report.compose"]).toMatchObject({
      rulesetVersion: "official-rules.v1",
      model: null,
      serviceTier: null,
    });
    expect(result.snapshot.sourceRefs).toContain(id("listing_source", 1));
    await expect(harness.repository.getActiveSnapshot(caseId)).resolves.toEqual(result.snapshot);
  });

  it("rejects client attempts to select, skip, or reorder stages", () => {
    expect(() =>
      AnalyzePipelineCommandSchema.parse({
        ...command(),
        requestedStages: ["report.compose"],
      }),
    ).toThrow();
    expect(() =>
      AnalyzePipelineCommandSchema.parse({
        ...command(),
        stageInputs: {
          ...command().stageInputs,
          "evidence.extract": {
            ...command().stageInputs["evidence.extract"],
            sourceRefs: [],
          },
        },
      }),
    ).toThrow();
  });

  it.each([
    ["owner", { owner: false }, "OWNER_GATE_REJECTED", ["owner"]],
    ["policy", { policy: false }, "POLICY_GATE_REJECTED", ["owner", "policy"]],
    ["upload", { upload: false }, "UPLOAD_GATE_REJECTED", ["owner", "policy", "upload"]],
  ] as const)(
    "fails closed at the %s gate before any stage",
    async (_name, options, code, calls) => {
      const harness = createHarness(options);
      const result = await harness.orchestrator.analyze(command());
      expect(result).toEqual({ ok: false, code, pipelineRun: null });
      expect(harness.gateCalls).toEqual(calls);
      expect(harness.executor.calls).toEqual([]);
      expect(harness.repository.getStageRuns()).toEqual([]);
    },
  );

  it("records provider failure as a failed StageRun and never runs downstream stages", async () => {
    const executor = new RecordingExecutor((input) => {
      if (input.stageId === "evidence.extract") {
        return {
          ok: false,
          code: "PROVIDER_REFUSED",
          resolvedModel: "gpt-5.6-terra",
          resolvedServiceTier: "default",
          providerRequestId: "provider-request-refused",
        };
      }
      return {
        ok: true,
        outputHash: hash(`${input.stageId}-output`),
        outputRefs: [id("provider_output", 1)],
        resolvedModel: input.configuration.requestedModel,
        resolvedServiceTier: "default",
        providerRequestId: "provider-request-success",
      };
    });
    const harness = createHarness({ executor });
    const result = await harness.orchestrator.analyze(command());

    expect(result).toMatchObject({ ok: false, code: "STAGE_FAILED" });
    expect(executor.calls).toEqual(["listing.extract", "evidence.extract"]);
    const runs = harness.repository.getStageRuns();
    expect(runs.map((run) => run.status)).toEqual(["succeeded", "failed"]);
    expect(runs[1]?.error).toEqual({
      code: "PROVIDER_REFUSED",
      providerRequestId: "provider-request-refused",
    });
    await expect(harness.repository.getActiveSnapshot(caseId)).resolves.toBeNull();
  });

  it("reuses successful stage keys without invoking the executor again", async () => {
    const harness = createHarness();
    const first = await harness.orchestrator.analyze(command(1));
    const second = await harness.orchestrator.analyze(command(2));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(harness.executor.calls).toEqual(PIPELINE_STAGE_ORDER);
    expect(harness.repository.getStageRuns()).toHaveLength(4);
    if (first.ok && second.ok) {
      expect(second.snapshot.stageHeads).toEqual(first.snapshot.stageHeads);
      expect(second.pipelineRun.stageRunIds).toEqual(first.pipelineRun.stageRunIds);
    }
  });

  it("does not commit a mixed-generation snapshot when the case revision changes", async () => {
    const repository = new InMemoryPipelineRepository();
    repository.setCaseRevision(caseId, 7);
    const executor = new RecordingExecutor((input) => {
      if (input.stageId === "report.compose") repository.setCaseRevision(caseId, 8);
      return {
        ok: true,
        outputHash: hash(`${input.stageId}-output`),
        outputRefs: [id("revision_output", 1)],
        resolvedModel: input.configuration.requestedModel,
        resolvedServiceTier: input.configuration.requestedServiceTier === null ? null : "default",
        providerRequestId: null,
      };
    });
    const calls: string[] = [];
    const orchestrator = new StageOrchestrator({
      repository,
      executor,
      ownerGate: new RecordingGate("owner", calls),
      policyGate: new RecordingGate("policy", calls),
      uploadGate: new RecordingGate("upload", calls),
      clock: new FixedClock(),
      idGenerator: new SequentialIds(),
    });
    const result = await orchestrator.analyze(command());

    expect(result).toMatchObject({ ok: false, code: "CASE_REVISION_CHANGED" });
    expect(repository.getStageRuns()).toHaveLength(4);
    await expect(repository.getActiveSnapshot(caseId)).resolves.toBeNull();
  });

  it("fails before creating a run when the base revision is already stale", async () => {
    const harness = createHarness();
    harness.repository.setCaseRevision(caseId, 8);
    const result = await harness.orchestrator.analyze(command());
    expect(result).toEqual({
      ok: false,
      code: "CASE_REVISION_CHANGED",
      pipelineRun: null,
    });
    expect(harness.executor.calls).toEqual([]);
  });

  it("records executor exceptions and invalid successful provenance as failures", async () => {
    const throwing = createHarness({
      executor: new RecordingExecutor(() => {
        throw new Error("provider crashed");
      }),
    });
    await expect(throwing.orchestrator.analyze(command())).resolves.toMatchObject({
      ok: false,
      code: "STAGE_FAILED",
    });
    expect(throwing.repository.getStageRuns()[0]?.error?.code).toBe("STAGE_EXECUTOR_FAILED");

    const missingResolved = createHarness({
      executor: new RecordingExecutor((input) => ({
        ok: true,
        outputHash: hash("invalid-success"),
        outputRefs: [id("invalid_output", 1)],
        resolvedModel: input.configuration.requestedModel,
        resolvedServiceTier: null,
        providerRequestId: null,
      })),
    });
    await expect(missingResolved.orchestrator.analyze(command())).resolves.toMatchObject({
      ok: false,
      code: "STAGE_FAILED",
    });
    expect(missingResolved.repository.getStageRuns()[0]?.error?.code).toBe(
      "PROVIDER_SCHEMA_INVALID",
    );
  });

  it("returns an existing running stage key instead of duplicating work", async () => {
    const harness = createHarness();
    const listingConfig = command().stageConfigurations["listing.extract"];
    const key = createStageKey({
      caseId,
      executionMode: "fixture",
      stageId: "listing.extract",
      directInputHash: command().stageInputs["listing.extract"].directInputHash,
      dependencyOutputHashes: [],
      configuration: listingConfig,
    });
    await harness.repository.claimStageKey(key.stageRunKey);

    const result = await harness.orchestrator.analyze(command());
    expect(result).toMatchObject({ ok: false, code: "STAGE_ALREADY_RUNNING" });
    expect(harness.executor.calls).toEqual([]);
  });
});

describe("StageRunSchema", () => {
  it("cannot represent provider failure as success", () => {
    expect(
      StageRunSchema.safeParse({
        id: id("stage_run", 99),
        pipelineRunId: id("pipeline", 99),
        caseId,
        stageId: "listing.extract",
        stageRunKey: hash("key"),
        directInputHash: hash("input"),
        dependencyHash: hash("dependency"),
        configHash: hash("config"),
        attempt: 1,
        status: "succeeded",
        provenance: {
          provenanceVersion: "rentproof.stage-provenance.v1",
          algorithmVersion: "listing.extract.algorithm.v1",
          promptVersion: "listing.extract.prompt.v1",
          schemaVersion: "listing.extract.schema.v1",
          rulesetVersion: null,
          model: {
            requested: "gpt-5.6-terra",
            resolved: "gpt-5.6-terra",
            reasoningEffort: "medium",
          },
          serviceTier: { requested: "default", resolved: "default" },
          sourceRefs: [id("source", 1)],
        },
        outputHash: null,
        outputRefs: [],
        error: { code: "PROVIDER_REFUSED", providerRequestId: "request-id" },
        startedAt,
        completedAt: "2026-09-02T06:00:10.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid failed and running state combinations", () => {
    const base = {
      id: id("stage_run", 98),
      pipelineRunId: id("pipeline", 98),
      caseId,
      stageId: "report.compose",
      stageRunKey: hash("key-98"),
      directInputHash: hash("input-98"),
      dependencyHash: hash("dependency-98"),
      configHash: hash("config-98"),
      attempt: 1,
      provenance: {
        provenanceVersion: "rentproof.stage-provenance.v1",
        algorithmVersion: "report.algorithm.v1",
        promptVersion: null,
        schemaVersion: "report.schema.v1",
        rulesetVersion: "official-rules.v1",
        model: null,
        serviceTier: null,
        sourceRefs: [id("source", 1)],
      },
      startedAt,
    };
    expect(
      StageRunSchema.safeParse({
        ...base,
        status: "failed",
        outputHash: hash("forbidden-output"),
        outputRefs: [id("output", 1)],
        error: null,
        completedAt: null,
      }).success,
    ).toBe(false);
    expect(
      StageRunSchema.safeParse({
        ...base,
        status: "running",
        outputHash: hash("forbidden-output"),
        outputRefs: [],
        error: null,
        completedAt: null,
      }).success,
    ).toBe(false);
  });
});

describe("pipeline contracts and repository guards", () => {
  it("rejects incomplete model configuration and provenance", () => {
    expect(
      StageConfigurationSchema.safeParse({
        ...cloudConfiguration("listing.extract"),
        requestedServiceTier: null,
      }).success,
    ).toBe(false);
    expect(
      StageProvenanceSchema.safeParse({
        provenanceVersion: "rentproof.stage-provenance.v1",
        algorithmVersion: "algorithm.v1",
        promptVersion: "prompt.v1",
        schemaVersion: "schema.v1",
        rulesetVersion: null,
        model: {
          requested: "gpt-5.6-terra",
          resolved: null,
          reasoningEffort: "medium",
        },
        serviceTier: null,
        sourceRefs: [id("source", 1)],
      }).success,
    ).toBe(false);
  });

  it("protects repository IDs and exposes defensive copies", async () => {
    const repository = new InMemoryPipelineRepository();
    await expect(repository.getCaseRevision(caseId)).resolves.toBeNull();
    const run = PipelineRunSchema.parse({
      id: id("pipeline", 50),
      caseId,
      baseCaseRevision: 0,
      executionMode: "fixture",
      status: "running",
      stageRunIds: [],
      snapshotId: null,
      errorCode: null,
      startedAt,
      completedAt: null,
    });
    await repository.createPipelineRun(run);
    expect(repository.getPipelineRun(run.id)).toEqual(run);
    expect(repository.getPipelineRun(id("pipeline", 51))).toBeNull();
    expect(() => repository.createPipelineRun(run)).toThrow("PIPELINE_RUN_ID_CONFLICT");
    expect(() => repository.savePipelineRun({ ...run, id: id("pipeline", 52) })).toThrow(
      "PIPELINE_RUN_NOT_FOUND",
    );
  });

  it("rejects unsupported canonical stage-key values", () => {
    expect(() => sha256Canonical(Number.NaN)).toThrow("Non-finite canonical value");
    expect(() => sha256Canonical(undefined)).toThrow("Unsupported canonical value");
  });
});
