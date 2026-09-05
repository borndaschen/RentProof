import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CancelJobSchema,
  CompleteJobSchema,
  DeleteJobSchema,
  EnqueueJobSchema,
  FailJobSchema,
  JobWorkSchema,
  JobLeaseCommandSchema,
  PurgeCaseJobsSchema,
  type ClaimedJob,
  type EnqueueJob,
  type JobQueueStateStore,
  type JobRecord,
  type JobWork,
} from "./contracts";
import type { EnqueueResult, FinishResult } from "./bounded-job-queue";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const TimestampSchema = z.number().int().nonnegative().safe();
const JobRecordSchema: z.ZodType<JobRecord> = z
  .object({
    jobId: OpaqueIdSchema,
    actorRef: OpaqueIdSchema,
    idempotencyHash: Sha256Schema,
    bindingHash: Sha256Schema,
    priority: z.enum(["blocking", "normal", "background"]),
    work: JobWorkSchema,
    state: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    attempt: z.number().int().nonnegative().safe(),
    createdAtMs: TimestampSchema,
    availableAtMs: TimestampSchema,
    leaseIdHash: Sha256Schema.nullable(),
    workerId: OpaqueIdSchema.nullable(),
    leaseExpiresAtMs: TimestampSchema.nullable(),
    completedAtMs: TimestampSchema.nullable(),
    resultRef: OpaqueIdSchema.nullable(),
    reasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,95}$/u)
      .nullable(),
  })
  .strict();

const SnapshotSchema = z
  .object({
    schemaVersion: z.literal("rentproof.job-queue.v1"),
    revision: z.number().int().nonnegative().safe(),
    records: z.array(JobRecordSchema),
  })
  .strict();

type Snapshot = z.infer<typeof SnapshotSchema>;
type PersistentQueueOptions = Readonly<{
  store: JobQueueStateStore;
  maxRecords?: number;
  maxRunning?: number;
  maxAttempts?: number;
  leaseMs?: number;
  retryDelayMs?: number;
  terminalRetentionMs?: number;
  maxContentionRetries?: number;
  clock?: () => number;
  idGenerator: () => string;
}>;

export type CancelResult =
  | Readonly<{ ok: true; state: "cancelled" }>
  | Readonly<{
      ok: false;
      code:
        | "JOB_COMMAND_INVALID"
        | "JOB_NOT_FOUND_OR_FORBIDDEN"
        | "JOB_REVISION_STALE"
        | "JOB_NOT_CANCELLABLE";
    }>;

export type DeleteResult =
  | Readonly<{ ok: true; deleted: boolean }>
  | Readonly<{
      ok: false;
      code: "JOB_COMMAND_INVALID" | "JOB_NOT_FOUND_OR_FORBIDDEN" | "JOB_NOT_TERMINAL";
    }>;

export type PurgeResult =
  | Readonly<{ ok: true; deletedCount: number }>
  | Readonly<{ ok: false; code: "JOB_COMMAND_INVALID" }>;

export type PersistentJobQueueErrorCode =
  | "JOB_QUEUE_CLOCK_INVALID"
  | "JOB_QUEUE_CONTENTION"
  | "JOB_QUEUE_CORRUPT"
  | "JOB_QUEUE_ID_CONFLICT"
  | "JOB_QUEUE_ID_INVALID";

export class PersistentJobQueueError extends Error {
  override readonly name = "PersistentJobQueueError";
  constructor(
    readonly code: PersistentJobQueueErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}

const priorityRank = { blocking: 0, normal: 1, background: 2 } as const;

/**
 * Durable, compare-and-swap job queue. Every state transition is committed as one versioned
 * snapshot before the operation returns. Worker authorization/policy checks remain mandatory:
 * actorRef, caseId and expectedRevision are bindings, not proof that the current Gate passes.
 */
export class PersistentBoundedJobQueue {
  readonly #options: Required<Omit<PersistentQueueOptions, "store" | "idGenerator">> &
    Pick<PersistentQueueOptions, "store" | "idGenerator">;

  constructor(options: PersistentQueueOptions) {
    this.#options = {
      store: options.store,
      maxRecords: options.maxRecords ?? 10_000,
      maxRunning: options.maxRunning ?? 2,
      maxAttempts: options.maxAttempts ?? 3,
      leaseMs: options.leaseMs ?? 60_000,
      retryDelayMs: options.retryDelayMs ?? 1_000,
      terminalRetentionMs: options.terminalRetentionMs ?? 24 * 60 * 60 * 1_000,
      maxContentionRetries: options.maxContentionRetries ?? 16,
      clock: options.clock ?? Date.now,
      idGenerator: options.idGenerator,
    };
    for (const [name, value] of Object.entries(this.#options)) {
      if (name !== "store" && name !== "clock" && name !== "idGenerator") {
        assertPositiveInteger(value as number, name);
      }
    }
  }

  async enqueue(input: unknown): Promise<EnqueueResult> {
    const command = EnqueueJobSchema.parse(input);
    return this.#mutate<EnqueueResult>((records, now) => {
      const idempotencyHash = hash(`${command.actorRef}\u0000${command.idempotencyKey}`);
      const bindingHash = hashBinding(command);
      const existing = records.find((record) => record.idempotencyHash === idempotencyHash);
      if (existing !== undefined) {
        return {
          result:
            existing.bindingHash === bindingHash
              ? { ok: true as const, jobId: existing.jobId, reused: true }
              : { ok: false as const, code: "JOB_IDEMPOTENCY_CONFLICT" as const },
          changed: false,
        };
      }
      if (records.length >= this.#options.maxRecords) {
        return {
          result: { ok: false as const, code: "JOB_QUEUE_CAPACITY_EXCEEDED" as const },
          changed: false,
        };
      }
      const jobId = this.#opaqueId(this.#options.idGenerator());
      if (records.some((record) => record.jobId === jobId)) {
        throw new PersistentJobQueueError("JOB_QUEUE_ID_CONFLICT");
      }
      records.push({
        jobId,
        actorRef: command.actorRef,
        idempotencyHash,
        bindingHash,
        priority: command.priority,
        work: structuredClone(command.work),
        state: "queued",
        attempt: 0,
        createdAtMs: now,
        availableAtMs: now,
        leaseIdHash: null,
        workerId: null,
        leaseExpiresAtMs: null,
        completedAtMs: null,
        resultRef: null,
        reasonCode: null,
      });
      return { result: { ok: true as const, jobId, reused: false }, changed: true };
    });
  }

  async claim(
    workerId: string,
    allowedTypes: readonly JobWork["type"][],
  ): Promise<ClaimedJob | null> {
    const validWorkerId = this.#opaqueId(workerId);
    const allowed = new Set(allowedTypes);
    if (
      allowed.size === 0 ||
      allowed.size !== allowedTypes.length ||
      allowedTypes.some(
        (type) => !JobWorkSchema.options.some((schema) => schema.shape.type.value === type),
      )
    ) {
      return null;
    }
    return this.#mutate<ClaimedJob | null>((records, now) => {
      const running = records.filter((record) => record.state === "running");
      if (running.length >= this.#options.maxRunning) return { result: null, changed: false };
      const runningCases = new Set(running.map((record) => record.work.caseId));
      const candidate = records
        .filter(
          (record) =>
            record.state === "queued" &&
            record.availableAtMs <= now &&
            allowed.has(record.work.type) &&
            !runningCases.has(record.work.caseId),
        )
        .sort(
          (left, right) =>
            priorityRank[left.priority] - priorityRank[right.priority] ||
            left.createdAtMs - right.createdAtMs ||
            left.jobId.localeCompare(right.jobId),
        )[0];
      if (candidate === undefined) return { result: null, changed: false };
      const leaseId = this.#opaqueId(this.#options.idGenerator());
      const index = records.findIndex((record) => record.jobId === candidate.jobId);
      const updated: JobRecord = {
        ...candidate,
        state: "running",
        attempt: candidate.attempt + 1,
        leaseIdHash: hash(leaseId),
        workerId: validWorkerId,
        leaseExpiresAtMs: now + this.#options.leaseMs,
      };
      records[index] = updated;
      return {
        result: {
          jobId: updated.jobId,
          actorRef: updated.actorRef,
          leaseId,
          work: structuredClone(updated.work),
          attempt: updated.attempt,
          leaseExpiresAtMs: updated.leaseExpiresAtMs ?? now,
        },
        changed: true,
      };
    });
  }

  async renew(input: unknown): Promise<FinishResult> {
    const parsed = JobLeaseCommandSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "JOB_COMMAND_INVALID" };
    return this.#finish(parsed.data, (record, now) => ({
      ...record,
      leaseExpiresAtMs: now + this.#options.leaseMs,
    }));
  }

  async complete(input: unknown): Promise<FinishResult> {
    const parsed = CompleteJobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "JOB_COMMAND_INVALID" };
    return this.#finish(parsed.data, (record, now) => ({
      ...record,
      state: "succeeded",
      leaseIdHash: null,
      workerId: null,
      leaseExpiresAtMs: null,
      completedAtMs: now,
      resultRef: parsed.data.resultRef,
      reasonCode: null,
    }));
  }

  async fail(input: unknown): Promise<FinishResult> {
    const parsed = FailJobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "JOB_COMMAND_INVALID" };
    return this.#finish(parsed.data, (record, now) => {
      const retry = parsed.data.retryable && record.attempt < this.#options.maxAttempts;
      return {
        ...record,
        state: retry ? "queued" : "failed",
        availableAtMs: retry ? now + this.#options.retryDelayMs : record.availableAtMs,
        leaseIdHash: null,
        workerId: null,
        leaseExpiresAtMs: null,
        completedAtMs: retry ? null : now,
        reasonCode: parsed.data.reasonCode,
      };
    });
  }

  async cancel(input: unknown): Promise<CancelResult> {
    const parsed = CancelJobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "JOB_COMMAND_INVALID" };
    return this.#mutate<CancelResult>((records, now) => {
      const index = records.findIndex((record) => record.jobId === parsed.data.jobId);
      const record = records[index];
      if (
        record === undefined ||
        record.actorRef !== parsed.data.actorRef ||
        record.work.caseId !== parsed.data.caseId
      ) {
        return {
          result: { ok: false as const, code: "JOB_NOT_FOUND_OR_FORBIDDEN" as const },
          changed: false,
        };
      }
      if (record.work.expectedRevision !== parsed.data.expectedRevision) {
        return {
          result: { ok: false as const, code: "JOB_REVISION_STALE" as const },
          changed: false,
        };
      }
      if (record.state === "cancelled") {
        return { result: { ok: true as const, state: "cancelled" as const }, changed: false };
      }
      if (record.state === "succeeded" || record.state === "failed") {
        return {
          result: { ok: false as const, code: "JOB_NOT_CANCELLABLE" as const },
          changed: false,
        };
      }
      records[index] = {
        ...record,
        state: "cancelled",
        leaseIdHash: null,
        workerId: null,
        leaseExpiresAtMs: null,
        completedAtMs: now,
        resultRef: null,
        reasonCode: "JOB_CANCELLED",
      };
      return { result: { ok: true as const, state: "cancelled" as const }, changed: true };
    });
  }

  async delete(input: unknown): Promise<DeleteResult> {
    const parsed = DeleteJobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "JOB_COMMAND_INVALID" };
    return this.#mutate<DeleteResult>((records) => {
      const index = records.findIndex((record) => record.jobId === parsed.data.jobId);
      const record = records[index];
      if (
        record === undefined ||
        record.actorRef !== parsed.data.actorRef ||
        record.work.caseId !== parsed.data.caseId
      ) {
        return {
          result: { ok: false as const, code: "JOB_NOT_FOUND_OR_FORBIDDEN" as const },
          changed: false,
        };
      }
      if (!isTerminal(record)) {
        return {
          result: { ok: false as const, code: "JOB_NOT_TERMINAL" as const },
          changed: false,
        };
      }
      records.splice(index, 1);
      return { result: { ok: true as const, deleted: true }, changed: true };
    });
  }

  async purgeCase(input: unknown): Promise<PurgeResult> {
    const parsed = PurgeCaseJobsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "JOB_COMMAND_INVALID" };
    return this.#mutate<PurgeResult>((records) => {
      const retained = records.filter(
        (record) =>
          record.actorRef !== parsed.data.actorRef || record.work.caseId !== parsed.data.caseId,
      );
      const deletedCount = records.length - retained.length;
      if (deletedCount > 0) records.splice(0, records.length, ...retained);
      return { result: { ok: true as const, deletedCount }, changed: deletedCount > 0 };
    });
  }

  async get(input: unknown): Promise<JobRecord | null> {
    const parsed = DeleteJobSchema.safeParse(input);
    if (!parsed.success) return null;
    return this.#mutate((records) => ({
      result: structuredClone(
        records.find(
          (record) =>
            record.jobId === parsed.data.jobId &&
            record.actorRef === parsed.data.actorRef &&
            record.work.caseId === parsed.data.caseId,
        ) ?? null,
      ),
      changed: false,
    }));
  }

  /** Caller must first deny access through the owner-scoped case deletion transaction. */
  async purgeDeletedCase(caseId: string): Promise<void> {
    OpaqueIdSchema.parse(caseId);
    await this.#mutate((records) => {
      const retained = records.filter((record) => record.work.caseId !== caseId);
      const changed = retained.length !== records.length;
      if (changed) records.splice(0, records.length, ...retained);
      return { result: undefined, changed };
    });
  }

  async #finish(
    command: { jobId: string; leaseId: string; workerId: string },
    update: (record: JobRecord, now: number) => JobRecord,
  ): Promise<FinishResult> {
    return this.#mutate<FinishResult>((records, now) => {
      const index = records.findIndex((record) => record.jobId === command.jobId);
      const record = records[index];
      if (
        record?.state !== "running" ||
        record.workerId !== command.workerId ||
        record.leaseIdHash !== hash(command.leaseId)
      ) {
        return { result: { ok: false as const, code: "JOB_LEASE_STALE" as const }, changed: false };
      }
      const next = update(record, now);
      records[index] = next;
      return {
        result: {
          ok: true as const,
          state: next.state as "queued" | "running" | "succeeded" | "failed",
        },
        changed: true,
      };
    });
  }

  async #mutate<T>(
    operation: (records: JobRecord[], now: number) => { result: T; changed: boolean },
  ): Promise<T> {
    for (let attempt = 0; attempt < this.#options.maxContentionRetries; attempt += 1) {
      const raw = await this.#options.store.readText();
      const snapshot = this.#parse(raw);
      const records = structuredClone(snapshot.records);
      const now = this.#now();
      const maintained = maintain(records, now, this.#options);
      const outcome = operation(records, now);
      if (!maintained && !outcome.changed && raw !== null) return outcome.result;
      const next: Snapshot = {
        schemaVersion: "rentproof.job-queue.v1",
        revision: snapshot.revision + 1,
        records,
      };
      assertSnapshotIntegrity(next, this.#options);
      if (await this.#options.store.writeTextIfUnchanged(raw, JSON.stringify(next))) {
        return outcome.result;
      }
    }
    throw new PersistentJobQueueError("JOB_QUEUE_CONTENTION");
  }

  #parse(raw: string | null): Snapshot {
    if (raw === null) {
      return { schemaVersion: "rentproof.job-queue.v1", revision: 0, records: [] };
    }
    try {
      const parsed = SnapshotSchema.parse(JSON.parse(raw) as unknown);
      assertSnapshotIntegrity(parsed, this.#options);
      return parsed;
    } catch (error: unknown) {
      if (error instanceof PersistentJobQueueError) throw error;
      throw new PersistentJobQueueError("JOB_QUEUE_CORRUPT", { cause: error });
    }
  }

  #now(): number {
    const value = this.#options.clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PersistentJobQueueError("JOB_QUEUE_CLOCK_INVALID");
    }
    return value;
  }

  #opaqueId(value: string): string {
    if (!OpaqueIdSchema.safeParse(value).success) {
      throw new PersistentJobQueueError("JOB_QUEUE_ID_INVALID");
    }
    return value;
  }
}

function maintain(
  records: JobRecord[],
  now: number,
  options: { maxAttempts: number; terminalRetentionMs: number },
): boolean {
  let changed = false;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) continue;
    if (
      record.state === "running" &&
      record.leaseExpiresAtMs !== null &&
      record.leaseExpiresAtMs <= now
    ) {
      records[index] = {
        ...record,
        state: record.attempt >= options.maxAttempts ? "failed" : "queued",
        availableAtMs: now,
        leaseIdHash: null,
        workerId: null,
        leaseExpiresAtMs: null,
        completedAtMs: record.attempt >= options.maxAttempts ? now : null,
        reasonCode: "JOB_LEASE_EXPIRED",
      };
      changed = true;
    } else if (
      isTerminal(record) &&
      record.completedAtMs !== null &&
      record.completedAtMs + options.terminalRetentionMs <= now
    ) {
      records.splice(index, 1);
      changed = true;
    }
  }
  return changed;
}

function assertSnapshotIntegrity(
  snapshot: Snapshot,
  options: { maxRecords: number; maxRunning: number; maxAttempts: number },
): void {
  if (snapshot.records.length > options.maxRecords)
    throw new PersistentJobQueueError("JOB_QUEUE_CORRUPT");
  const ids = new Set<string>();
  const idempotencyHashes = new Set<string>();
  const runningCases = new Set<string>();
  let runningCount = 0;
  for (const record of snapshot.records) {
    if (ids.has(record.jobId) || idempotencyHashes.has(record.idempotencyHash)) {
      throw new PersistentJobQueueError("JOB_QUEUE_CORRUPT");
    }
    ids.add(record.jobId);
    idempotencyHashes.add(record.idempotencyHash);
    if (record.attempt > options.maxAttempts) {
      throw new PersistentJobQueueError("JOB_QUEUE_CORRUPT");
    }
    if (record.state === "running") {
      runningCount += 1;
      if (runningCases.has(record.work.caseId)) {
        throw new PersistentJobQueueError("JOB_QUEUE_CORRUPT");
      }
      runningCases.add(record.work.caseId);
    }
    const leaseCoherent =
      record.state === "running"
        ? record.leaseIdHash !== null &&
          record.workerId !== null &&
          record.leaseExpiresAtMs !== null &&
          record.completedAtMs === null
        : record.leaseIdHash === null &&
          record.workerId === null &&
          record.leaseExpiresAtMs === null;
    const terminalCoherent = isTerminal(record)
      ? record.completedAtMs !== null
      : record.completedAtMs === null;
    if (!leaseCoherent || !terminalCoherent || record.attempt < 0) {
      throw new PersistentJobQueueError("JOB_QUEUE_CORRUPT");
    }
  }
  if (runningCount > options.maxRunning) throw new PersistentJobQueueError("JOB_QUEUE_CORRUPT");
}

function isTerminal(record: JobRecord): boolean {
  return record.state === "succeeded" || record.state === "failed" || record.state === "cancelled";
}

function hashBinding(command: EnqueueJob): string {
  return hash(
    JSON.stringify({ actorRef: command.actorRef, priority: command.priority, work: command.work }),
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} is invalid`);
}
