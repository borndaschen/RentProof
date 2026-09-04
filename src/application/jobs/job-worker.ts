import type { ClaimedJob, CompleteJob, FailJob, JobExecutionGate, JobWork } from "./contracts";

export interface WorkerQueuePort {
  claim(workerId: string, allowedTypes: readonly JobWork["type"][]): Promise<ClaimedJob | null>;
  complete(input: CompleteJob): Promise<{ ok: boolean }>;
  fail(input: FailJob): Promise<{ ok: boolean }>;
}

export type JobHandler = (
  work: JobWork,
  context: Readonly<{ jobId: string; actorRef: string; attempt: number }>,
) => Promise<{ resultRef: string }>;

export type JobHandlerRegistry = Readonly<Record<JobWork["type"], JobHandler>>;

export type WorkerRunResult =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "succeeded" | "failed" | "denied"; jobId: string }>;

export class JobHandlerError extends Error {
  override readonly name = "JobHandlerError";
  constructor(
    readonly reasonCode: string,
    readonly retryable: boolean,
  ) {
    super(reasonCode);
    if (!/^[A-Z][A-Z0-9_]{2,95}$/u.test(reasonCode)) throw new Error("JOB_REASON_INVALID");
  }
}

/** Claims one allowlisted job, re-runs authorization/policy gates, then records a leased result. */
export class GovernedJobWorker {
  constructor(
    private readonly queue: WorkerQueuePort,
    private readonly gate: JobExecutionGate,
    private readonly handlers: JobHandlerRegistry,
  ) {}

  async runOnce(workerId: string): Promise<WorkerRunResult> {
    const allowedTypes = Object.keys(this.handlers) as JobWork["type"][];
    const job = await this.queue.claim(workerId, allowedTypes);
    if (job === null) return { status: "idle" };
    const command = { jobId: job.jobId, leaseId: job.leaseId, workerId };
    const decision = await this.gate.authorize({
      jobId: job.jobId,
      actorRef: job.actorRef,
      work: job.work,
      attempt: job.attempt,
    });
    if (!decision.ok) {
      await this.requireTransition(
        this.queue.fail({ ...command, reasonCode: decision.reasonCode, retryable: false }),
      );
      return { status: "denied", jobId: job.jobId };
    }
    try {
      const handler = this.handlers[job.work.type];
      const result = await handler(job.work, {
        jobId: job.jobId,
        actorRef: job.actorRef,
        attempt: job.attempt,
      });
      await this.requireTransition(
        this.queue.complete({ ...command, resultRef: result.resultRef }),
      );
      return { status: "succeeded", jobId: job.jobId };
    } catch (error) {
      const failure =
        error instanceof JobHandlerError ? error : new JobHandlerError("JOB_HANDLER_FAILED", true);
      await this.requireTransition(
        this.queue.fail({
          ...command,
          reasonCode: failure.reasonCode,
          retryable: failure.retryable,
        }),
      );
      return { status: "failed", jobId: job.jobId };
    }
  }

  private async requireTransition(operation: Promise<{ ok: boolean }>): Promise<void> {
    if (!(await operation).ok) throw new Error("JOB_LEASE_TRANSITION_FAILED");
  }
}
