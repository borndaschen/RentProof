import { AnalysisSnapshotSchema, PipelineRunSchema, StageRunSchema } from "./contracts";
import type { AnalysisSnapshot, PipelineRun, StageRun } from "./contracts";
import type { PipelineRepository, StageKeyClaim } from "./ports";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryPipelineRepository implements PipelineRepository {
  readonly #caseRevisions = new Map<string, number>();
  readonly #pipelineRuns = new Map<string, PipelineRun>();
  readonly #stageRuns: StageRun[] = [];
  readonly #successfulByKey = new Map<string, StageRun>();
  readonly #activeStageKeys = new Set<string>();
  readonly #attemptsByKey = new Map<string, number>();
  readonly #activeSnapshots = new Map<string, AnalysisSnapshot>();

  setCaseRevision(caseId: string, revision: number): void {
    this.#caseRevisions.set(caseId, revision);
  }

  getCaseRevision(caseId: string): Promise<number | null> {
    return Promise.resolve(this.#caseRevisions.get(caseId) ?? null);
  }

  createPipelineRun(run: PipelineRun): Promise<void> {
    const parsed = PipelineRunSchema.parse(run);
    if (this.#pipelineRuns.has(parsed.id)) throw new Error("PIPELINE_RUN_ID_CONFLICT");
    this.#pipelineRuns.set(parsed.id, clone(parsed));
    return Promise.resolve();
  }

  savePipelineRun(run: PipelineRun): Promise<void> {
    const parsed = PipelineRunSchema.parse(run);
    if (!this.#pipelineRuns.has(parsed.id)) throw new Error("PIPELINE_RUN_NOT_FOUND");
    this.#pipelineRuns.set(parsed.id, clone(parsed));
    return Promise.resolve();
  }

  claimStageKey(stageRunKey: string): Promise<StageKeyClaim> {
    const cached = this.#successfulByKey.get(stageRunKey);
    if (cached !== undefined) {
      return Promise.resolve({ kind: "cached", stageRun: clone(cached) });
    }
    if (this.#activeStageKeys.has(stageRunKey)) return Promise.resolve({ kind: "running" });

    this.#activeStageKeys.add(stageRunKey);
    const attempt = (this.#attemptsByKey.get(stageRunKey) ?? 0) + 1;
    this.#attemptsByKey.set(stageRunKey, attempt);
    return Promise.resolve({ kind: "acquired", attempt });
  }

  releaseStageKey(stageRunKey: string): Promise<void> {
    this.#activeStageKeys.delete(stageRunKey);
    return Promise.resolve();
  }

  appendStageRun(run: StageRun): Promise<void> {
    const parsed = StageRunSchema.parse(run);
    this.#stageRuns.push(clone(parsed));
    if (parsed.status === "succeeded") {
      this.#successfulByKey.set(parsed.stageRunKey, clone(parsed));
    }
    return Promise.resolve();
  }

  commitSnapshot(snapshot: AnalysisSnapshot, expectedRevision: number): Promise<boolean> {
    const parsed = AnalysisSnapshotSchema.parse(snapshot);
    if (this.#caseRevisions.get(parsed.caseId) !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.#activeSnapshots.set(parsed.caseId, clone(parsed));
    return Promise.resolve(true);
  }

  getActiveSnapshot(caseId: string): Promise<AnalysisSnapshot | null> {
    const snapshot = this.#activeSnapshots.get(caseId);
    return Promise.resolve(snapshot === undefined ? null : clone(snapshot));
  }

  getStageRuns(): readonly StageRun[] {
    return this.#stageRuns.map(clone);
  }

  getPipelineRun(pipelineRunId: string): PipelineRun | null {
    const run = this.#pipelineRuns.get(pipelineRunId);
    return run === undefined ? null : clone(run);
  }
}
