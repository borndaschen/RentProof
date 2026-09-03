import { z } from "zod";
import type { AnalysisSnapshot, PipelineRun, StageConfiguration, StageRun } from "./contracts";
import type { PipelineStageId } from "./dag";

export type GateResult = Readonly<{ ok: true }> | Readonly<{ ok: false }>;

export interface OwnerGate {
  verifyOwner(caseId: string): Promise<GateResult>;
}

export interface PolicyGate {
  verifyPolicy(caseId: string): Promise<GateResult>;
}

export interface UploadGate {
  verifyUploads(caseId: string): Promise<GateResult>;
}

const SuccessfulStageExecutionSchema = z
  .object({
    ok: z.literal(true),
    outputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    outputRefs: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u))
      .min(1)
      .max(100),
    resolvedModel: z.string().min(1).max(64).nullable(),
    resolvedServiceTier: z.string().min(1).max(64).nullable(),
    providerRequestId: z.string().max(128).nullable(),
  })
  .strict();

const FailedStageExecutionSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum([
      "PROVIDER_REFUSED",
      "PROVIDER_INCOMPLETE",
      "PROVIDER_SCHEMA_INVALID",
      "PROVIDER_AUTH_FAILED",
      "PROVIDER_RATE_LIMITED",
      "LOCATOR_INVALID",
      "STAGE_EXECUTOR_FAILED",
    ]),
    resolvedModel: z.string().min(1).max(64).nullable(),
    resolvedServiceTier: z.string().min(1).max(64).nullable(),
    providerRequestId: z.string().max(128).nullable(),
  })
  .strict();

export const StageExecutionResultSchema = z.discriminatedUnion("ok", [
  SuccessfulStageExecutionSchema,
  FailedStageExecutionSchema,
]);

export type StageExecutionResult = z.infer<typeof StageExecutionResultSchema>;

export type ExecuteStageInput = Readonly<{
  caseId: string;
  stageId: PipelineStageId;
  executionMode: "fixture" | "live";
  configuration: StageConfiguration;
  directSourceRefs: readonly string[];
  dependencyOutputRefs: readonly string[];
}>;

export interface StageExecutor {
  execute(input: ExecuteStageInput): Promise<StageExecutionResult>;
}

export interface PipelineClock {
  now(): Date;
}

export interface StageRunIdGenerator {
  nextStageRunId(stageId: PipelineStageId, attempt: number): string;
}

export type StageKeyClaim =
  | Readonly<{ kind: "acquired"; attempt: number }>
  | Readonly<{ kind: "cached"; stageRun: StageRun }>
  | Readonly<{ kind: "running" }>;

export interface PipelineRepository {
  getCaseRevision(caseId: string): Promise<number | null>;
  createPipelineRun(run: PipelineRun): Promise<void>;
  savePipelineRun(run: PipelineRun): Promise<void>;
  claimStageKey(stageRunKey: string): Promise<StageKeyClaim>;
  releaseStageKey(stageRunKey: string): Promise<void>;
  appendStageRun(run: StageRun): Promise<void>;
  commitSnapshot(snapshot: AnalysisSnapshot, expectedRevision: number): Promise<boolean>;
  getActiveSnapshot(caseId: string): Promise<AnalysisSnapshot | null>;
}
