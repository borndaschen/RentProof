import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  CONVERSATION_LIMITS,
  IsoInstantSchema,
  OpaqueIdSchema,
  Sha256Schema,
} from "@/domain/conversation";

export const PiiAcknowledgementRecordSchema = z
  .object({
    acknowledgementIdHash: Sha256Schema,
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    caseRevision: z.number().int().nonnegative(),
    payloadHash: Sha256Schema,
    detectorVersion: z.string().min(1).max(100),
    createdAt: IsoInstantSchema,
    expiresAt: IsoInstantSchema,
    status: z.enum(["pending", "consumed", "revoked"]),
    consumedAt: IsoInstantSchema.nullable(),
  })
  .strict();

export type PiiAcknowledgementRecord = z.infer<typeof PiiAcknowledgementRecordSchema>;

export const ConsumePiiAcknowledgementSchema = z
  .object({
    acknowledgementId: OpaqueIdSchema,
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    expectedCaseRevision: z.number().int().nonnegative(),
    payloadHash: Sha256Schema,
  })
  .strict();

export type ConsumePiiAcknowledgement = z.infer<typeof ConsumePiiAcknowledgementSchema>;

export type IssuePiiAcknowledgement = {
  actorRef: string;
  caseId: string;
  caseRevision: number;
  payloadHash: string;
  detectorVersion: string;
  nowMs?: number;
};

export type ConsumePiiAcknowledgementResult =
  { ok: true } | { ok: false; code: "PII_ACK_EXPIRED" | "PII_ACK_STALE" | "PII_ACK_ALREADY_USED" };

export const PII_ACKNOWLEDGEMENT_MAX_RECORDS = 10_000;
export const PII_ACKNOWLEDGEMENT_TERMINAL_RETENTION_MS =
  CONVERSATION_LIMITS.piiAcknowledgementTtlMs;

export class PiiAcknowledgementStoreCapacityError extends Error {
  constructor() {
    super("PII_ACK_STORE_CAPACITY_EXCEEDED");
    this.name = "PiiAcknowledgementStoreCapacityError";
  }
}

type InMemoryPiiAcknowledgementStoreOptions = Readonly<{
  maxRecords?: number;
  terminalRetentionMs?: number;
}>;

export class InMemoryPiiAcknowledgementStore {
  readonly #records = new Map<string, PiiAcknowledgementRecord>();
  readonly #maxRecords: number;
  readonly #terminalRetentionMs: number;

  constructor(options: InMemoryPiiAcknowledgementStoreOptions = {}) {
    this.#maxRecords = options.maxRecords ?? PII_ACKNOWLEDGEMENT_MAX_RECORDS;
    this.#terminalRetentionMs =
      options.terminalRetentionMs ?? PII_ACKNOWLEDGEMENT_TERMINAL_RETENTION_MS;
    if (!Number.isSafeInteger(this.#maxRecords) || this.#maxRecords < 1) {
      throw new RangeError("maxRecords must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.#terminalRetentionMs) || this.#terminalRetentionMs < 0) {
      throw new RangeError("terminalRetentionMs must be a non-negative safe integer");
    }
  }

  issue(input: IssuePiiAcknowledgement): {
    acknowledgementId: string;
    expiresAt: string;
  } {
    const nowMs = input.nowMs ?? Date.now();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new RangeError("nowMs must be a non-negative safe integer");
    }
    this.#prune(nowMs);
    if (this.#records.size >= this.#maxRecords) {
      throw new PiiAcknowledgementStoreCapacityError();
    }
    const acknowledgementId = randomBytes(32).toString("base64url");
    const acknowledgementIdHash = sha256(acknowledgementId);
    const record = PiiAcknowledgementRecordSchema.parse({
      acknowledgementIdHash,
      actorRef: input.actorRef,
      caseId: input.caseId,
      caseRevision: input.caseRevision,
      payloadHash: input.payloadHash,
      detectorVersion: input.detectorVersion,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + CONVERSATION_LIMITS.piiAcknowledgementTtlMs).toISOString(),
      status: "pending",
      consumedAt: null,
    });
    this.#records.set(acknowledgementIdHash, record);
    return { acknowledgementId, expiresAt: record.expiresAt };
  }

  consume(untrustedCommand: unknown, nowMs = Date.now()): ConsumePiiAcknowledgementResult {
    const parsed = ConsumePiiAcknowledgementSchema.safeParse(untrustedCommand);
    if (!parsed.success || !Number.isSafeInteger(nowMs) || nowMs < 0) {
      return { ok: false, code: "PII_ACK_STALE" };
    }

    this.#prune(nowMs);
    const command = parsed.data;
    const idHash = sha256(command.acknowledgementId);
    const record = this.#records.get(idHash);
    if (!record) {
      return { ok: false, code: "PII_ACK_STALE" };
    }
    if (record.status === "consumed") {
      return { ok: false, code: "PII_ACK_ALREADY_USED" };
    }
    if (record.status !== "pending") {
      return { ok: false, code: "PII_ACK_STALE" };
    }
    if (nowMs >= Date.parse(record.expiresAt)) {
      return { ok: false, code: "PII_ACK_EXPIRED" };
    }
    if (
      record.actorRef !== command.actorRef ||
      record.caseId !== command.caseId ||
      record.caseRevision !== command.expectedCaseRevision ||
      record.payloadHash !== command.payloadHash
    ) {
      return { ok: false, code: "PII_ACK_STALE" };
    }

    this.#records.set(idHash, {
      ...record,
      status: "consumed",
      consumedAt: new Date(nowMs).toISOString(),
    });
    return { ok: true };
  }

  revoke(acknowledgementId: string): void {
    const idHash = sha256(acknowledgementId);
    const record = this.#records.get(idHash);
    if (record?.status === "pending") {
      this.#records.set(idHash, { ...record, status: "revoked" });
    }
  }

  #prune(nowMs: number): void {
    for (const [idHash, record] of this.#records) {
      const purgeAt = Date.parse(record.expiresAt) + this.#terminalRetentionMs;
      if (nowMs >= purgeAt) this.#records.delete(idHash);
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
