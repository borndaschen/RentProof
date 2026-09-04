import { z } from "zod";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);

export const JobWorkSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("contract.ocr"),
      caseId: OpaqueIdSchema,
      artifactId: OpaqueIdSchema,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("evidence.video_frames"),
      caseId: OpaqueIdSchema,
      artifactId: OpaqueIdSchema,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("analysis.pipeline"),
      caseId: OpaqueIdSchema,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);

export const EnqueueJobSchema = z
  .object({
    actorRef: OpaqueIdSchema,
    idempotencyKey: OpaqueIdSchema,
    priority: z.enum(["blocking", "normal", "background"]),
    work: JobWorkSchema,
  })
  .strict();

export const JobLeaseCommandSchema = z
  .object({
    jobId: OpaqueIdSchema,
    leaseId: OpaqueIdSchema,
    workerId: OpaqueIdSchema,
  })
  .strict();

export const CompleteJobSchema = JobLeaseCommandSchema.extend({
  resultRef: OpaqueIdSchema,
}).strict();

export const FailJobSchema = JobLeaseCommandSchema.extend({
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,95}$/u),
  retryable: z.boolean(),
}).strict();

export const CancelJobSchema = z
  .object({
    actorRef: OpaqueIdSchema,
    jobId: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const DeleteJobSchema = CancelJobSchema.omit({ expectedRevision: true }).strict();

export const PurgeCaseJobsSchema = z
  .object({
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
  })
  .strict();

export type JobWork = z.infer<typeof JobWorkSchema>;
export type EnqueueJob = z.infer<typeof EnqueueJobSchema>;
export type CompleteJob = z.infer<typeof CompleteJobSchema>;
export type FailJob = z.infer<typeof FailJobSchema>;
export type CancelJob = z.infer<typeof CancelJobSchema>;
export type DeleteJob = z.infer<typeof DeleteJobSchema>;
export type PurgeCaseJobs = z.infer<typeof PurgeCaseJobsSchema>;

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobRecord = Readonly<{
  jobId: string;
  actorRef: string;
  idempotencyHash: string;
  bindingHash: string;
  priority: EnqueueJob["priority"];
  work: JobWork;
  state: JobState;
  attempt: number;
  createdAtMs: number;
  availableAtMs: number;
  leaseIdHash: string | null;
  workerId: string | null;
  leaseExpiresAtMs: number | null;
  completedAtMs: number | null;
  resultRef: string | null;
  reasonCode: string | null;
}>;

export type ClaimedJob = Readonly<{
  jobId: string;
  actorRef: string;
  leaseId: string;
  work: JobWork;
  attempt: number;
  leaseExpiresAtMs: number;
}>;

/**
 * Compare-and-swap persistence boundary. Infrastructure adapters own all filesystem/database
 * details; application code only reads and atomically replaces one versioned JSON document.
 */
export interface JobQueueStateStore {
  readText(): Promise<string | null>;
  writeTextIfUnchanged(expectedText: string | null, nextText: string): Promise<boolean>;
}

export type JobExecutionGateDecision =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reasonCode:
        | "JOB_OWNER_GATE_FAILED"
        | "JOB_CASE_DELETED"
        | "JOB_REVISION_STALE"
        | "JOB_POLICY_GATE_FAILED"
        | "JOB_CLOUD_NOTICE_REQUIRED"
        | "JOB_BUDGET_GATE_FAILED";
    }>;

/** Must be called after claim and before private storage or provider access. */
export interface JobExecutionGate {
  authorize(
    input: Readonly<{
      jobId: string;
      actorRef: string;
      work: JobWork;
      attempt: number;
    }>,
  ): Promise<JobExecutionGateDecision>;
}
