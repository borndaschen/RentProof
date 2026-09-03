import { z } from "zod";
import { PIPELINE_STAGE_ORDER } from "./dag";

export const PipelineOpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
export const PipelineSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const PipelineStageIdSchema = z.enum(PIPELINE_STAGE_ORDER);
export const ExecutionModeSchema = z.enum(["fixture", "live"]);

const VersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);
const SourceRefsSchema = z.array(PipelineOpaqueIdSchema).min(1).max(100);

export const StageConfigurationSchema = z
  .object({
    algorithmVersion: VersionSchema,
    promptVersion: VersionSchema.nullable(),
    schemaVersion: VersionSchema,
    rulesetVersion: VersionSchema.nullable(),
    requestedModel: VersionSchema.nullable(),
    reasoningEffort: z.enum(["low", "medium"]).nullable(),
    requestedServiceTier: z.literal("default").nullable(),
  })
  .strict()
  .superRefine((configuration, context) => {
    const hasModel = configuration.requestedModel !== null;
    if (
      hasModel !== (configuration.reasoningEffort !== null) ||
      hasModel !== (configuration.requestedServiceTier !== null) ||
      hasModel !== (configuration.promptVersion !== null)
    ) {
      context.addIssue({ code: "custom", message: "MODEL_CONFIGURATION_INCOMPLETE" });
    }
  });

export const StageProvenanceSchema = z
  .object({
    provenanceVersion: z.literal("rentproof.stage-provenance.v1"),
    algorithmVersion: VersionSchema,
    promptVersion: VersionSchema.nullable(),
    schemaVersion: VersionSchema,
    rulesetVersion: VersionSchema.nullable(),
    model: z
      .object({
        requested: VersionSchema,
        resolved: VersionSchema.nullable(),
        reasoningEffort: z.enum(["low", "medium"]),
      })
      .strict()
      .nullable(),
    serviceTier: z
      .object({ requested: z.literal("default"), resolved: VersionSchema.nullable() })
      .strict()
      .nullable(),
    sourceRefs: SourceRefsSchema,
  })
  .strict()
  .superRefine((provenance, context) => {
    if ((provenance.model === null) !== (provenance.serviceTier === null)) {
      context.addIssue({ code: "custom", message: "MODEL_PROVENANCE_INCOMPLETE" });
    }
  });

const StageErrorSchema = z
  .object({
    code: z.enum([
      "PROVIDER_REFUSED",
      "PROVIDER_INCOMPLETE",
      "PROVIDER_SCHEMA_INVALID",
      "PROVIDER_AUTH_FAILED",
      "PROVIDER_RATE_LIMITED",
      "LOCATOR_INVALID",
      "STAGE_EXECUTOR_FAILED",
    ]),
    providerRequestId: z.string().max(128).nullable(),
  })
  .strict();

export const StageRunSchema = z
  .object({
    id: PipelineOpaqueIdSchema,
    pipelineRunId: PipelineOpaqueIdSchema,
    caseId: PipelineOpaqueIdSchema,
    stageId: PipelineStageIdSchema,
    stageRunKey: PipelineSha256Schema,
    directInputHash: PipelineSha256Schema,
    dependencyHash: PipelineSha256Schema,
    configHash: PipelineSha256Schema,
    attempt: z.number().int().min(1),
    status: z.enum(["running", "succeeded", "failed"]),
    provenance: StageProvenanceSchema,
    outputHash: PipelineSha256Schema.nullable(),
    outputRefs: z.array(PipelineOpaqueIdSchema).max(100),
    error: StageErrorSchema.nullable(),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (
      run.status === "succeeded" &&
      (run.outputHash === null ||
        run.outputRefs.length === 0 ||
        run.error !== null ||
        run.completedAt === null)
    ) {
      context.addIssue({ code: "custom", message: "SUCCEEDED_STAGE_RUN_INVALID" });
    }
    if (
      run.status === "failed" &&
      (run.outputHash !== null ||
        run.outputRefs.length !== 0 ||
        run.error === null ||
        run.completedAt === null)
    ) {
      context.addIssue({ code: "custom", message: "FAILED_STAGE_RUN_INVALID" });
    }
    if (
      run.status === "running" &&
      (run.outputHash !== null || run.outputRefs.length !== 0 || run.error !== null)
    ) {
      context.addIssue({ code: "custom", message: "RUNNING_STAGE_RUN_INVALID" });
    }
  });

export const PipelineRunSchema = z
  .object({
    id: PipelineOpaqueIdSchema,
    caseId: PipelineOpaqueIdSchema,
    baseCaseRevision: z.number().int().nonnegative(),
    executionMode: ExecutionModeSchema,
    status: z.enum(["running", "succeeded", "failed"]),
    stageRunIds: z.array(PipelineOpaqueIdSchema).max(PIPELINE_STAGE_ORDER.length),
    snapshotId: PipelineOpaqueIdSchema.nullable(),
    errorCode: z
      .enum([
        "OWNER_GATE_REJECTED",
        "POLICY_GATE_REJECTED",
        "UPLOAD_GATE_REJECTED",
        "CASE_REVISION_CHANGED",
        "STAGE_ALREADY_RUNNING",
        "STAGE_FAILED",
      ])
      .nullable(),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

const StageHeadMapSchema = z
  .object({
    "listing.extract": PipelineOpaqueIdSchema,
    "evidence.extract": PipelineOpaqueIdSchema,
    "contract.extract": PipelineOpaqueIdSchema,
    "report.compose": PipelineOpaqueIdSchema,
  })
  .strict();

const StageProvenanceMapSchema = z
  .object({
    "listing.extract": StageProvenanceSchema,
    "evidence.extract": StageProvenanceSchema,
    "contract.extract": StageProvenanceSchema,
    "report.compose": StageProvenanceSchema,
  })
  .strict();

export const AnalysisSnapshotSchema = z
  .object({
    id: PipelineOpaqueIdSchema,
    pipelineRunId: PipelineOpaqueIdSchema,
    caseId: PipelineOpaqueIdSchema,
    caseRevision: z.number().int().nonnegative(),
    executionMode: ExecutionModeSchema,
    stageHeads: StageHeadMapSchema,
    stageProvenance: StageProvenanceMapSchema,
    sourceRefs: SourceRefsSchema,
    reportRef: PipelineOpaqueIdSchema,
    snapshotHash: PipelineSha256Schema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const StageInputSchema = z
  .object({
    directInputHash: PipelineSha256Schema,
    sourceRefs: z.array(PipelineOpaqueIdSchema).max(100),
  })
  .strict();

export const AnalyzePipelineCommandSchema = z
  .object({
    pipelineRunId: PipelineOpaqueIdSchema,
    snapshotId: PipelineOpaqueIdSchema,
    caseId: PipelineOpaqueIdSchema,
    baseCaseRevision: z.number().int().nonnegative(),
    executionMode: ExecutionModeSchema,
    startedAt: z.iso.datetime({ offset: true }),
    stageInputs: z
      .object({
        "listing.extract": StageInputSchema,
        "evidence.extract": StageInputSchema,
        "contract.extract": StageInputSchema,
        "report.compose": StageInputSchema,
      })
      .strict(),
    stageConfigurations: z
      .object({
        "listing.extract": StageConfigurationSchema,
        "evidence.extract": StageConfigurationSchema,
        "contract.extract": StageConfigurationSchema,
        "report.compose": StageConfigurationSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((command, context) => {
    for (const stageId of ["listing.extract", "evidence.extract", "contract.extract"] as const) {
      if (command.stageInputs[stageId].sourceRefs.length === 0) {
        context.addIssue({ code: "custom", message: "STAGE_SOURCE_REF_REQUIRED" });
      }
    }
  });

export type AnalyzePipelineCommand = z.infer<typeof AnalyzePipelineCommandSchema>;
export type AnalysisSnapshot = z.infer<typeof AnalysisSnapshotSchema>;
export type PipelineRun = z.infer<typeof PipelineRunSchema>;
export type StageConfiguration = z.infer<typeof StageConfigurationSchema>;
export type StageProvenance = z.infer<typeof StageProvenanceSchema>;
export type StageRun = z.infer<typeof StageRunSchema>;
