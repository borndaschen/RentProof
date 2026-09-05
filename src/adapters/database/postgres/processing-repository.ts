import { createHash } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { ActorContext } from "@/application/repositories";
import {
  REAL_DEMO_CLOUD_CONSENT_TEXT,
  REAL_DEMO_CLOUD_CONSENT_VERSION,
} from "@/application/real-demo";
import {
  ProcessingRecordSchema,
  processingActorRef,
  type ProcessingRecord,
  type ProcessingRepository,
} from "@/application/processing/contracts";
import { validateOcrConfirmation } from "@/application/ocr/confirm-ocr";
import type { JobQueueStateStore } from "@/application/jobs";
import type { RentProofDatabase } from "./database";

export class PostgresProcessingRepository implements ProcessingRepository {
  constructor(private readonly database: Kysely<RentProofDatabase>) {}

  async authorize(actor: ActorContext, caseId: string) {
    return authorize(this.database, actor, caseId);
  }

  async find(actor: ActorContext, caseId: string, artifactId: string) {
    await this.authorize(actor, caseId);
    const row = await this.database
      .selectFrom("artifact_processing")
      .select("record")
      .where("id", "=", artifactId)
      .where("case_id", "=", caseId)
      .where("actor_ref", "=", processingActorRef(actor))
      .executeTakeFirst();
    return row ? ProcessingRecordSchema.parse(row.record) : null;
  }

  async findByKey(actor: ActorContext, caseId: string, hash: string) {
    await this.authorize(actor, caseId);
    const row = await this.database
      .selectFrom("artifact_processing")
      .select("record")
      .where("idempotency_hash", "=", hash)
      .where("case_id", "=", caseId)
      .where("actor_ref", "=", processingActorRef(actor))
      .executeTakeFirst();
    return row ? ProcessingRecordSchema.parse(row.record) : null;
  }

  async findWork(actorRef: string, caseId: string, artifactId: string) {
    const row = await this.database
      .selectFrom("artifact_processing")
      .select("record")
      .where("id", "=", artifactId)
      .where("case_id", "=", caseId)
      .where("actor_ref", "=", actorRef)
      .executeTakeFirst();
    if (!row) return null;
    const record = ProcessingRecordSchema.parse(row.record);
    await this.authorize(record.actor, caseId);
    return record;
  }

  async create(untrusted: ProcessingRecord): Promise<void> {
    const record = ProcessingRecordSchema.parse(untrusted);
    await this.database.transaction().execute(async (db) => {
      const current = await authorize(db, record.actor, record.reservation.caseId, true);
      assertCurrent(record, current);
      const count = await db
        .selectFrom("artifact_processing")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .select(
          sql<string>`COALESCE(SUM(CASE WHEN record->>'state' IN ('queued', 'requires_confirmation') AND record->'reservation'->>'mime' <> 'application/pdf' THEN (record->'reservation'->>'originalBytes')::bigint ELSE 0 END), 0) + (SELECT COALESCE(SUM(original_bytes), 0) FROM case_artifacts WHERE case_id = ${record.reservation.caseId} AND mime <> 'application/pdf' AND deleted_at IS NULL)`.as(
            "totalBytes",
          ),
        )
        .where("case_id", "=", record.reservation.caseId)
        .executeTakeFirstOrThrow();
      if (Number(count.count) >= 16) throw new Error("PROCESSING_CASE_CAPACITY_EXCEEDED");
      if (
        record.reservation.mime !== "application/pdf" &&
        BigInt(count.totalBytes) + BigInt(record.reservation.originalBytes) > 400n * 1024n * 1024n
      ) {
        throw new Error("REAL_DEMO_CASE_IMAGE_LIMIT_EXCEEDED");
      }
      await db
        .insertInto("artifact_processing")
        .values({
          id: record.reservation.artifactId,
          case_id: record.reservation.caseId,
          actor_ref: processingActorRef(record.actor),
          idempotency_hash: record.idempotencyHash,
          record,
          created_at: new Date(),
        })
        .execute();
    });
  }

  async replace(record: ProcessingRecord, expectedState: ProcessingRecord["state"]): Promise<void> {
    await this.database.transaction().execute(async (db) => {
      const current = await authorize(db, record.actor, record.reservation.caseId, true);
      if (record.state !== "cancelled") assertCurrent(record, current);
      const old = await lockedRecord(db, record);
      if (old.state !== expectedState) throw new Error("PROCESSING_STATE_STALE");
      await db
        .updateTable("artifact_processing")
        .set({ record: ProcessingRecordSchema.parse(record) })
        .where("id", "=", record.reservation.artifactId)
        .execute();
    });
  }

  async finalize(
    record: ProcessingRecord,
    stored: Parameters<ProcessingRepository["finalize"]>[1],
    confirmation?: Parameters<ProcessingRepository["finalize"]>[2],
  ): Promise<void> {
    await this.database.transaction().execute(async (db) => {
      const current = await authorize(db, record.actor, record.reservation.caseId, true);
      const old = await lockedRecord(db, record);
      if (old.state === "available") throw new Error("OCR_CONFIRMATION_USED");
      assertCurrent(old, current);
      if (old.type === "contract.ocr") {
        if (!confirmation || old.state !== "requires_confirmation")
          throw new Error("OCR_HUMAN_CONFIRMATION_REQUIRED");
        validateOcrConfirmation({
          pending: old.confirmation,
          pages: confirmation.pages,
          actor: record.actor,
          caseId: old.reservation.caseId,
          artifactId: old.reservation.artifactId,
          confirmationId: confirmation.confirmationId,
          revision: current.revision,
          policyHash: current.policyHash,
          explicitlyConfirmed: true,
          nowMs: confirmation.nowMs,
        });
      } else if (old.state !== "queued") throw new Error("PROCESSING_STATE_STALE");
      const reservation = old.reservation;
      const total = await db
        .selectFrom("case_artifacts")
        .select(sql<string>`COALESCE(SUM(original_bytes), 0)`.as("total"))
        .where("case_id", "=", reservation.caseId)
        .where("mime", "!=", "application/pdf")
        .where("deleted_at", "is", null)
        .executeTakeFirstOrThrow();
      if (
        reservation.mime !== "application/pdf" &&
        BigInt(total.total) + BigInt(reservation.originalBytes) > 400n * 1024n * 1024n
      ) {
        throw new Error("REAL_DEMO_CASE_IMAGE_LIMIT_EXCEEDED");
      }
      await db
        .insertInto("case_artifacts")
        .values({
          id: reservation.artifactId,
          case_id: reservation.caseId,
          owner_type: record.actor.kind,
          owner_subject_id: subject(record.actor),
          artifact_kind: reservation.kind,
          state: "available",
          mime: reservation.mime,
          original_sha256: reservation.originalSha256,
          original_bytes: reservation.originalBytes,
          original_relative_path: stored.originalRelativePath,
          derivative_relative_path: stored.derivativeRelativePath,
          extracted_text_relative_path: stored.extractedTextRelativePath,
          derivative_sha256: stored.derivativeSha256,
          derivative_bytes: stored.derivativeBytes,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        })
        .execute();
      await db
        .updateTable("artifact_processing")
        .set({
          record: {
            ...old,
            stored,
            state: "available",
            confirmation: old.confirmation ? { ...old.confirmation, state: "used" } : null,
          },
        })
        .where("id", "=", reservation.artifactId)
        .execute();
      const caseState = { ...current.state };
      Reflect.deleteProperty(caseState, "analysisSnapshot");
      await db
        .updateTable("rental_cases")
        .set({
          state: caseState,
          revision: current.revision + 1,
          updated_at: new Date(),
          status: "draft",
          active_snapshot_id: null,
        })
        .where("id", "=", reservation.caseId)
        .execute();
    });
  }
}

async function lockedRecord(db: Kysely<RentProofDatabase>, record: ProcessingRecord) {
  const row = await db
    .selectFrom("artifact_processing")
    .select("record")
    .where("id", "=", record.reservation.artifactId)
    .where("case_id", "=", record.reservation.caseId)
    .where("actor_ref", "=", processingActorRef(record.actor))
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new Error("PROCESSING_NOT_FOUND_OR_FORBIDDEN");
  return ProcessingRecordSchema.parse(row.record);
}

function assertCurrent(
  record: ProcessingRecord,
  current: { revision: number; policyHash: string },
) {
  if (record.expectedRevision !== current.revision) throw new Error("PROCESSING_REVISION_STALE");
  if (record.policyHash !== current.policyHash) throw new Error("PROCESSING_POLICY_STALE");
}

function subject(actor: ActorContext) {
  return actor.kind === "guest" ? actor.guestSessionId : actor.userId;
}

async function authorize(
  db: Kysely<RentProofDatabase>,
  actor: ActorContext,
  caseId: string,
  lock = false,
) {
  const now = new Date();
  const session =
    actor.kind === "guest"
      ? await db
          .selectFrom("guest_sessions")
          .innerJoin("guest_identities", "guest_identities.id", "guest_sessions.guest_id")
          .select("guest_sessions.id")
          .where("guest_sessions.id", "=", actor.guestSessionId)
          .where("guest_sessions.guest_id", "=", actor.guestId)
          .where("guest_sessions.revoked_at", "is", null)
          .where("guest_sessions.expires_at", ">", now)
          .where("guest_identities.expires_at", ">", now)
          .where("guest_identities.purge_state", "=", "active")
          .forUpdate()
          .executeTakeFirst()
      : await db
          .selectFrom("auth_sessions")
          .innerJoin("internal_users", "internal_users.id", "auth_sessions.user_id")
          .select("auth_sessions.id")
          .where("auth_sessions.id", "=", actor.sessionId)
          .where("auth_sessions.user_id", "=", actor.userId)
          .where("auth_sessions.revoked_at", "is", null)
          .where("auth_sessions.idle_expires_at", ">", now)
          .where("internal_users.status", "=", "active")
          .forUpdate()
          .executeTakeFirst();
  if (!session) throw new Error("REAL_DEMO_AUTH_REQUIRED");
  let query = db
    .selectFrom("rental_cases")
    .select(["revision", "state"])
    .where("id", "=", caseId)
    .where("owner_type", "=", actor.kind)
    .where("owner_subject_id", "=", subject(actor))
    .where("deleted_at", "is", null)
    .where("status", "!=", "deletion_pending");
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) throw new Error("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
  const state = row.state;
  if (
    typeof state !== "object" ||
    state === null ||
    Array.isArray(state) ||
    Reflect.get(state, "cloudProcessingConsentVersion") !== REAL_DEMO_CLOUD_CONSENT_VERSION ||
    typeof Reflect.get(state, "cloudProcessingAcknowledgedAt") !== "string"
  ) {
    throw new Error("PROCESSING_CLOUD_NOTICE_REQUIRED");
  }
  return {
    revision: row.revision,
    state,
    policyHash: createHash("sha256").update(REAL_DEMO_CLOUD_CONSENT_TEXT).digest("hex"),
  };
}

export class PostgresJobQueueStateStore implements JobQueueStateStore {
  constructor(private readonly database: Kysely<RentProofDatabase>) {}
  async readText() {
    const row = await this.database
      .selectFrom("runtime_queue_state")
      .select("payload")
      .where("id", "=", "media")
      .executeTakeFirstOrThrow();
    return row.payload;
  }
  async writeTextIfUnchanged(expectedText: string | null, nextText: string) {
    if (Buffer.byteLength(nextText) > 32 * 1024 * 1024)
      throw new Error("JOB_QUEUE_CAPACITY_EXCEEDED");
    let query = this.database
      .updateTable("runtime_queue_state")
      .set({ payload: nextText })
      .where("id", "=", "media");
    query =
      expectedText === null
        ? query.where("payload", "is", null)
        : query.where("payload", "=", expectedText);
    return (await query.returning("id").executeTakeFirst()) !== undefined;
  }
}
