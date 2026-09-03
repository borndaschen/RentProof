import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { OpaqueIdSchema, Sha256Schema } from "@/domain/conversation";

export const IdempotencyBindingSchema = z
  .object({
    idempotencyKey: OpaqueIdSchema,
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    normalizedPayloadHash: Sha256Schema,
  })
  .strict();

export type IdempotencyBinding = z.infer<typeof IdempotencyBindingSchema>;

export const CompleteIdempotentOperationSchema = z
  .object({
    leaseId: OpaqueIdSchema,
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    idempotencyKey: OpaqueIdSchema,
    resultRef: OpaqueIdSchema,
  })
  .strict();

export type CompleteIdempotentOperation = z.infer<typeof CompleteIdempotentOperationSchema>;

export const ReleaseIdempotentOperationSchema = CompleteIdempotentOperationSchema.omit({
  resultRef: true,
});

export type ReleaseIdempotentOperation = z.infer<typeof ReleaseIdempotentOperationSchema>;

type PendingRecord = {
  state: "pending";
  keyHash: string;
  actorRef: string;
  caseId: string;
  normalizedPayloadHash: string;
  operationId: string;
  leaseIdHash: string;
  createdAtMs: number;
  expiresAtMs: number;
};

type CompletedRecord = {
  state: "completed";
  keyHash: string;
  actorRef: string;
  caseId: string;
  normalizedPayloadHash: string;
  operationId: string;
  resultRef: string;
  createdAtMs: number;
  completedAtMs: number;
  expiresAtMs: number;
};

type IdempotencyRecord = PendingRecord | CompletedRecord;

type CaseLease = {
  keyHash: string;
  leaseIdHash: string;
  expiresAtMs: number;
};

export type BeginIdempotentOperationResult =
  | { kind: "acquired"; operationId: string; leaseId: string }
  | { kind: "pending_reuse"; operationId: string }
  | { kind: "result_reuse"; operationId: string; resultRef: string }
  | { kind: "conflict"; code: "IDEMPOTENCY_KEY_REUSED" }
  | { kind: "case_busy"; code: "CONVERSATION_TURN_IN_PROGRESS" }
  | { kind: "unavailable" };

export type CompleteIdempotentOperationResult =
  { ok: true } | { ok: false; reason: "invalid" | "stale" };

export type InMemoryIdempotencyStoreOptions = {
  pendingLeaseTtlMs?: number;
  completedRetentionMs?: number;
  maxRecords?: number;
};

const DEFAULT_PENDING_LEASE_TTL_MS = 60_000;
const DEFAULT_COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1_000;

export class InMemoryConversationIdempotencyStore {
  readonly #records = new Map<string, IdempotencyRecord>();
  readonly #caseLeases = new Map<string, CaseLease>();
  readonly #pendingLeaseTtlMs: number;
  readonly #completedRetentionMs: number;
  readonly #maxRecords: number;

  constructor(options: InMemoryIdempotencyStoreOptions = {}) {
    this.#pendingLeaseTtlMs = options.pendingLeaseTtlMs ?? DEFAULT_PENDING_LEASE_TTL_MS;
    this.#completedRetentionMs = options.completedRetentionMs ?? DEFAULT_COMPLETED_RETENTION_MS;
    this.#maxRecords = options.maxRecords ?? 10_000;

    assertPositiveFinite(this.#pendingLeaseTtlMs, "pendingLeaseTtlMs");
    assertPositiveFinite(this.#completedRetentionMs, "completedRetentionMs");
    if (!Number.isSafeInteger(this.#maxRecords) || this.#maxRecords < 1) {
      throw new RangeError("maxRecords must be a positive safe integer");
    }
  }

  begin(untrustedBinding: unknown, nowMs = Date.now()): BeginIdempotentOperationResult {
    const binding = IdempotencyBindingSchema.parse(untrustedBinding);
    assertTimestamp(nowMs);
    this.#prune(nowMs);

    const keyHash = sha256(binding.idempotencyKey);
    const existing = this.#records.get(keyHash);
    if (existing) {
      if (!hasSameBinding(existing, binding)) {
        return { kind: "conflict", code: "IDEMPOTENCY_KEY_REUSED" };
      }
      if (existing.state === "pending") {
        return { kind: "pending_reuse", operationId: existing.operationId };
      }
      return {
        kind: "result_reuse",
        operationId: existing.operationId,
        resultRef: existing.resultRef,
      };
    }

    if (this.#records.size >= this.#maxRecords) {
      return { kind: "unavailable" };
    }
    if (this.#caseLeases.has(binding.caseId)) {
      return { kind: "case_busy", code: "CONVERSATION_TURN_IN_PROGRESS" };
    }

    const operationId = opaqueToken();
    const leaseId = opaqueToken();
    const leaseIdHash = sha256(leaseId);
    const expiresAtMs = nowMs + this.#pendingLeaseTtlMs;
    this.#records.set(keyHash, {
      state: "pending",
      keyHash,
      actorRef: binding.actorRef,
      caseId: binding.caseId,
      normalizedPayloadHash: binding.normalizedPayloadHash,
      operationId,
      leaseIdHash,
      createdAtMs: nowMs,
      expiresAtMs,
    });
    this.#caseLeases.set(binding.caseId, { keyHash, leaseIdHash, expiresAtMs });
    return { kind: "acquired", operationId, leaseId };
  }

  complete(untrustedCommand: unknown, nowMs = Date.now()): CompleteIdempotentOperationResult {
    const parsed = CompleteIdempotentOperationSchema.safeParse(untrustedCommand);
    if (!parsed.success || !isTimestamp(nowMs)) {
      return { ok: false, reason: "invalid" };
    }
    this.#prune(nowMs);

    const command = parsed.data;
    const keyHash = sha256(command.idempotencyKey);
    const leaseIdHash = sha256(command.leaseId);
    const record = this.#records.get(keyHash);
    const caseLease = this.#caseLeases.get(command.caseId);
    if (
      record?.state !== "pending" ||
      record.actorRef !== command.actorRef ||
      record.caseId !== command.caseId ||
      record.leaseIdHash !== leaseIdHash ||
      caseLease?.keyHash !== keyHash ||
      caseLease.leaseIdHash !== leaseIdHash
    ) {
      return { ok: false, reason: "stale" };
    }

    this.#records.set(keyHash, {
      state: "completed",
      keyHash,
      actorRef: record.actorRef,
      caseId: record.caseId,
      normalizedPayloadHash: record.normalizedPayloadHash,
      operationId: record.operationId,
      resultRef: command.resultRef,
      createdAtMs: record.createdAtMs,
      completedAtMs: nowMs,
      expiresAtMs: nowMs + this.#completedRetentionMs,
    });
    this.#caseLeases.delete(command.caseId);
    return { ok: true };
  }

  release(untrustedCommand: unknown, nowMs = Date.now()): boolean {
    const parsed = ReleaseIdempotentOperationSchema.safeParse(untrustedCommand);
    if (!parsed.success || !isTimestamp(nowMs)) {
      return false;
    }
    this.#prune(nowMs);

    const command = parsed.data;
    const keyHash = sha256(command.idempotencyKey);
    const leaseIdHash = sha256(command.leaseId);
    const record = this.#records.get(keyHash);
    const caseLease = this.#caseLeases.get(command.caseId);
    if (
      record?.state !== "pending" ||
      record.actorRef !== command.actorRef ||
      record.caseId !== command.caseId ||
      record.leaseIdHash !== leaseIdHash ||
      caseLease?.keyHash !== keyHash ||
      caseLease.leaseIdHash !== leaseIdHash
    ) {
      return false;
    }

    this.#records.delete(keyHash);
    this.#caseLeases.delete(command.caseId);
    return true;
  }

  #prune(nowMs: number): void {
    for (const [keyHash, record] of this.#records) {
      if (nowMs < record.expiresAtMs) {
        continue;
      }
      this.#records.delete(keyHash);
      if (record.state === "pending") {
        const caseLease = this.#caseLeases.get(record.caseId);
        if (caseLease?.keyHash === keyHash && caseLease.leaseIdHash === record.leaseIdHash) {
          this.#caseLeases.delete(record.caseId);
        }
      }
    }

    for (const [caseId, lease] of this.#caseLeases) {
      if (nowMs >= lease.expiresAtMs) {
        this.#caseLeases.delete(caseId);
      }
    }
  }
}

function hasSameBinding(record: IdempotencyRecord, binding: IdempotencyBinding): boolean {
  return (
    record.actorRef === binding.actorRef &&
    record.caseId === binding.caseId &&
    record.normalizedPayloadHash === binding.normalizedPayloadHash
  );
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
}

function isTimestamp(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function assertTimestamp(value: number): void {
  if (!isTimestamp(value)) {
    throw new RangeError("nowMs must be a non-negative finite timestamp");
  }
}
