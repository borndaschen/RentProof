import { createHash } from "node:crypto";
import {
  CompleteJobSchema,
  EnqueueJobSchema,
  FailJobSchema,
  type ClaimedJob,
  type EnqueueJob,
  type JobRecord,
  type JobWork,
} from "./contracts";

type QueueOptions = Readonly<{
  maxRecords?: number;
  maxRunning?: number;
  maxAttempts?: number;
  leaseMs?: number;
  retryDelayMs?: number;
  terminalRetentionMs?: number;
  clock?: () => number;
  idGenerator: () => string;
}>;

export type EnqueueResult =
  | Readonly<{ ok: true; jobId: string; reused: boolean }>
  | Readonly<{ ok: false; code: "JOB_IDEMPOTENCY_CONFLICT" | "JOB_QUEUE_CAPACITY_EXCEEDED" }>;

export type FinishResult =
  | Readonly<{ ok: true; state: "queued" | "running" | "succeeded" | "failed" }>
  | Readonly<{ ok: false; code: "JOB_COMMAND_INVALID" | "JOB_LEASE_STALE" }>;

const priorityRank = { blocking: 0, normal: 1, background: 2 } as const;

export class InMemoryBoundedJobQueue {
  readonly #records = new Map<string, JobRecord>();
  readonly #jobIdByIdempotencyHash = new Map<string, string>();
  readonly #options: Required<Omit<QueueOptions, "idGenerator">> &
    Pick<QueueOptions, "idGenerator">;

  constructor(options: QueueOptions) {
    this.#options = {
      maxRecords: options.maxRecords ?? 10_000,
      maxRunning: options.maxRunning ?? 2,
      maxAttempts: options.maxAttempts ?? 3,
      leaseMs: options.leaseMs ?? 60_000,
      retryDelayMs: options.retryDelayMs ?? 1_000,
      terminalRetentionMs: options.terminalRetentionMs ?? 24 * 60 * 60 * 1_000,
      clock: options.clock ?? Date.now,
      idGenerator: options.idGenerator,
    };
    assertPositiveInteger(this.#options.maxRecords, "maxRecords");
    assertPositiveInteger(this.#options.maxRunning, "maxRunning");
    assertPositiveInteger(this.#options.maxAttempts, "maxAttempts");
    assertPositiveInteger(this.#options.leaseMs, "leaseMs");
    assertPositiveInteger(this.#options.retryDelayMs, "retryDelayMs");
    assertPositiveInteger(this.#options.terminalRetentionMs, "terminalRetentionMs");
  }

  enqueue(input: unknown): EnqueueResult {
    const command = EnqueueJobSchema.parse(input);
    const now = this.#now();
    this.#maintain(now);
    const idempotencyHash = hash(command.idempotencyKey);
    const bindingHash = hashBinding(command);
    const existingId = this.#jobIdByIdempotencyHash.get(idempotencyHash);
    if (existingId !== undefined) {
      const existing = this.#records.get(existingId);
      if (existing === undefined) throw new Error("JOB_QUEUE_INTEGRITY_ERROR");
      return existing.bindingHash === bindingHash
        ? { ok: true, jobId: existing.jobId, reused: true }
        : { ok: false, code: "JOB_IDEMPOTENCY_CONFLICT" };
    }
    if (this.#records.size >= this.#options.maxRecords) {
      return { ok: false, code: "JOB_QUEUE_CAPACITY_EXCEEDED" };
    }
    const jobId = this.#opaqueId(this.#options.idGenerator());
    if (this.#records.has(jobId)) throw new Error("JOB_ID_CONFLICT");
    const record: JobRecord = {
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
    };
    this.#records.set(jobId, record);
    this.#jobIdByIdempotencyHash.set(idempotencyHash, jobId);
    return { ok: true, jobId, reused: false };
  }

  claim(workerId: string, allowedTypes: readonly JobWork["type"][]): ClaimedJob | null {
    const validWorkerId = this.#opaqueId(workerId);
    if (allowedTypes.length === 0 || new Set(allowedTypes).size !== allowedTypes.length)
      return null;
    const now = this.#now();
    this.#maintain(now);
    const running = [...this.#records.values()].filter((record) => record.state === "running");
    if (running.length >= this.#options.maxRunning) return null;
    const runningCases = new Set(running.map((record) => record.work.caseId));
    const candidate = [...this.#records.values()]
      .filter(
        (record) =>
          record.state === "queued" &&
          record.availableAtMs <= now &&
          allowedTypes.includes(record.work.type) &&
          !runningCases.has(record.work.caseId),
      )
      .sort(
        (left, right) =>
          priorityRank[left.priority] - priorityRank[right.priority] ||
          left.createdAtMs - right.createdAtMs ||
          left.jobId.localeCompare(right.jobId),
      )[0];
    if (candidate === undefined) return null;
    const leaseId = this.#opaqueId(this.#options.idGenerator());
    const updated: JobRecord = {
      ...candidate,
      state: "running",
      attempt: candidate.attempt + 1,
      leaseIdHash: hash(leaseId),
      workerId: validWorkerId,
      leaseExpiresAtMs: now + this.#options.leaseMs,
    };
    this.#records.set(candidate.jobId, updated);
    return {
      jobId: updated.jobId,
      actorRef: updated.actorRef,
      leaseId,
      work: structuredClone(updated.work),
      attempt: updated.attempt,
      leaseExpiresAtMs: updated.leaseExpiresAtMs ?? now,
    };
  }

  complete(input: unknown): FinishResult {
    const parsed = CompleteJobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "JOB_COMMAND_INVALID" };
    const now = this.#now();
    this.#maintain(now);
    const record = this.#leasedRecord(parsed.data.jobId, parsed.data.leaseId, parsed.data.workerId);
    if (record === null) return { ok: false, code: "JOB_LEASE_STALE" };
    this.#records.set(record.jobId, {
      ...record,
      state: "succeeded",
      leaseIdHash: null,
      workerId: null,
      leaseExpiresAtMs: null,
      completedAtMs: now,
      resultRef: parsed.data.resultRef,
      reasonCode: null,
    });
    return { ok: true, state: "succeeded" };
  }

  fail(input: unknown): FinishResult {
    const parsed = FailJobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "JOB_COMMAND_INVALID" };
    const now = this.#now();
    this.#maintain(now);
    const record = this.#leasedRecord(parsed.data.jobId, parsed.data.leaseId, parsed.data.workerId);
    if (record === null) return { ok: false, code: "JOB_LEASE_STALE" };
    const retry = parsed.data.retryable && record.attempt < this.#options.maxAttempts;
    this.#records.set(record.jobId, {
      ...record,
      state: retry ? "queued" : "failed",
      availableAtMs: retry ? now + this.#options.retryDelayMs : record.availableAtMs,
      leaseIdHash: null,
      workerId: null,
      leaseExpiresAtMs: null,
      completedAtMs: retry ? null : now,
      reasonCode: parsed.data.reasonCode,
    });
    return { ok: true, state: retry ? "queued" : "failed" };
  }

  get(jobId: string): JobRecord | null {
    const record = this.#records.get(jobId);
    return record === undefined ? null : structuredClone(record);
  }

  #leasedRecord(jobId: string, leaseId: string, workerId: string): JobRecord | null {
    const record = this.#records.get(jobId);
    return record?.state === "running" &&
      record.workerId === workerId &&
      record.leaseIdHash === hash(leaseId)
      ? record
      : null;
  }

  #maintain(now: number): void {
    for (const [jobId, record] of this.#records) {
      if (
        record.state === "running" &&
        record.leaseExpiresAtMs !== null &&
        record.leaseExpiresAtMs <= now
      ) {
        this.#records.set(jobId, {
          ...record,
          state: record.attempt >= this.#options.maxAttempts ? "failed" : "queued",
          availableAtMs: now,
          leaseIdHash: null,
          workerId: null,
          leaseExpiresAtMs: null,
          completedAtMs: record.attempt >= this.#options.maxAttempts ? now : null,
          reasonCode: "JOB_LEASE_EXPIRED",
        });
        continue;
      }
      if (
        (record.state === "succeeded" || record.state === "failed") &&
        record.completedAtMs !== null &&
        record.completedAtMs + this.#options.terminalRetentionMs <= now
      ) {
        this.#records.delete(jobId);
        this.#jobIdByIdempotencyHash.delete(record.idempotencyHash);
      }
    }
  }

  #now(): number {
    const value = this.#options.clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("JOB_QUEUE_CLOCK_INVALID");
    return value;
  }

  #opaqueId(value: string): string {
    if (!/^[A-Za-z0-9_-]{20,128}$/u.test(value)) throw new Error("JOB_QUEUE_ID_INVALID");
    return value;
  }
}

function hashBinding(command: EnqueueJob): string {
  return hash(
    JSON.stringify({
      actorRef: command.actorRef,
      priority: command.priority,
      work: command.work,
    }),
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} is invalid`);
}
