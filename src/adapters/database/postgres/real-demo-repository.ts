import { randomBytes } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { RealDemoRepositoryPort } from "@/application/real-demo";
import { RealDemoAccessError } from "@/application/real-demo";
import type { ActorContext } from "@/application/repositories";
import type { RentProofDatabase } from "./database";

const CASE_IMAGE_BYTES_LIMIT = 400 * 1024 * 1024;

export class PostgresRealDemoRepository implements RealDemoRepositoryPort {
  constructor(private readonly database: Kysely<RentProofDatabase>) {}

  async createCase(input: Parameters<RealDemoRepositoryPort["createCase"]>[0]) {
    const caseId = `case_${randomBytes(24).toString("hex")}`;
    const policyId = "policy_cloud_processing_demo_v1";
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("policy_documents")
        .values({
          id: policyId,
          policy_type: "cloud_processing_notice",
          version: input.cloudProcessingConsentVersion,
          locale: "zh-TW",
          content_hash: input.cloudProcessingConsentHash,
          canonical_url: "urn:rentproof:cloud-processing-demo:v1",
          status: "draft",
          published_at: null,
          effective_at: null,
        })
        .onConflict((conflict) =>
          conflict.columns(["policy_type", "version", "locale"]).doNothing(),
        )
        .execute();
      const policy = await transaction
        .selectFrom("policy_documents")
        .select(["id", "content_hash"])
        .where("policy_type", "=", "cloud_processing_notice")
        .where("version", "=", input.cloudProcessingConsentVersion)
        .where("locale", "=", "zh-TW")
        .executeTakeFirstOrThrow();
      if (policy.id !== policyId || policy.content_hash !== input.cloudProcessingConsentHash) {
        throw new RealDemoAccessError("REAL_DEMO_REQUEST_INVALID");
      }
      await transaction
        .insertInto("rental_cases")
        .values({
          id: caseId,
          owner_type: input.actor.kind,
          owner_subject_id: actorSubject(input.actor),
          display_name: input.displayName,
          status: "draft",
          revision: 0,
          active_snapshot_id: null,
          state: {
            schemaVersion: "rentproof.real-case-state.v1",
            cloudProcessingConsentVersion: input.cloudProcessingConsentVersion,
            cloudProcessingAcknowledgedAt: input.now.toISOString(),
          },
          source_mode: "live",
          created_at: input.now,
          updated_at: input.now,
          deleted_at: null,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("policy_events")
        .values({
          id: `policy_event_${randomBytes(24).toString("hex")}`,
          actor_type: input.actor.kind,
          actor_subject_id: actorSubject(input.actor),
          policy_document_id: policyId,
          event_type: "consented",
          occurred_at: input.now,
          source_route: "/api/real-cases",
          case_id: caseId,
          analysis_run_id: null,
          processor_list_version: "openai-processors.v1",
          audit_ref: `audit_${randomBytes(24).toString("hex")}`,
        })
        .executeTakeFirstOrThrow();
    });
    return { caseId };
  }

  async reserveArtifact(input: Parameters<RealDemoRepositoryPort["reserveArtifact"]>[0]) {
    try {
      await this.database.transaction().execute(async (transaction) => {
        const owned = await transaction
          .selectFrom("rental_cases")
          .select("id")
          .where("id", "=", input.reservation.caseId)
          .where("owner_type", "=", input.actor.kind)
          .where("owner_subject_id", "=", actorSubject(input.actor))
          .where("deleted_at", "is", null)
          .where("status", "!=", "deletion_pending")
          .forUpdate()
          .executeTakeFirst();
        if (!owned) throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");

        if (input.reservation.mime !== "application/pdf") {
          const total = await transaction
            .selectFrom("case_artifacts")
            .select(sql<string>`COALESCE(SUM(original_bytes), 0)`.as("total"))
            .where("case_id", "=", input.reservation.caseId)
            .where("owner_type", "=", input.actor.kind)
            .where("owner_subject_id", "=", actorSubject(input.actor))
            .where("deleted_at", "is", null)
            .where("mime", "!=", "application/pdf")
            .executeTakeFirstOrThrow();
          if (
            BigInt(total.total) + BigInt(input.reservation.originalBytes) >
            CASE_IMAGE_BYTES_LIMIT
          ) {
            throw new RealDemoAccessError("REAL_DEMO_CASE_IMAGE_LIMIT_EXCEEDED");
          }
        }

        await transaction
          .insertInto("case_artifacts")
          .values({
            id: input.reservation.artifactId,
            case_id: input.reservation.caseId,
            owner_type: input.actor.kind,
            owner_subject_id: actorSubject(input.actor),
            artifact_kind: input.reservation.kind,
            state: "quarantined",
            mime: input.reservation.mime,
            original_sha256: input.reservation.originalSha256,
            derivative_sha256: null,
            original_bytes: input.reservation.originalBytes,
            derivative_bytes: null,
            original_relative_path: `${input.reservation.caseId}/${input.reservation.artifactId}/original.enc`,
            derivative_relative_path: null,
            extracted_text_relative_path: null,
            created_at: input.now,
            updated_at: input.now,
            deleted_at: null,
          })
          .executeTakeFirstOrThrow();
      });
    } catch (error) {
      if (error instanceof RealDemoAccessError) throw error;
      if (postgresCode(error) === "23505") {
        throw new RealDemoAccessError("REAL_DEMO_DUPLICATE_ARTIFACT");
      }
      throw error;
    }
  }

  async finalizeArtifact(input: Parameters<RealDemoRepositoryPort["finalizeArtifact"]>[0]) {
    await this.database.transaction().execute(async (transaction) => {
      const artifact = await transaction
        .updateTable("case_artifacts")
        .set({
          state: "available",
          original_relative_path: input.stored.originalRelativePath,
          derivative_relative_path: input.stored.derivativeRelativePath,
          extracted_text_relative_path: input.stored.extractedTextRelativePath,
          derivative_sha256: input.stored.derivativeSha256,
          derivative_bytes: input.stored.derivativeBytes,
          updated_at: input.now,
        })
        .where("id", "=", input.reservation.artifactId)
        .where("case_id", "=", input.reservation.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("state", "=", "quarantined")
        .where("deleted_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!artifact) throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
      await transaction
        .updateTable("rental_cases")
        .set((expression) => ({
          revision: expression("revision", "+", 1),
          updated_at: input.now,
        }))
        .where("id", "=", input.reservation.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("deleted_at", "is", null)
        .executeTakeFirstOrThrow();
    });
  }

  async abandonArtifact(input: Parameters<RealDemoRepositoryPort["abandonArtifact"]>[0]) {
    await this.database
      .updateTable("case_artifacts")
      .set({ state: "deletion_pending", deleted_at: input.now, updated_at: input.now })
      .where("id", "=", input.reservation.artifactId)
      .where("case_id", "=", input.reservation.caseId)
      .where("owner_type", "=", input.actor.kind)
      .where("owner_subject_id", "=", actorSubject(input.actor))
      .where("state", "=", "quarantined")
      .execute();
  }

  async deleteCase(input: Parameters<RealDemoRepositoryPort["deleteCase"]>[0]): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const deleted = await transaction
        .updateTable("rental_cases")
        .set((expression) => ({
          status: "deletion_pending",
          deleted_at: input.now,
          updated_at: input.now,
          revision: expression("revision", "+", 1),
        }))
        .where("id", "=", input.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("deleted_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!deleted) {
        const pending = await transaction
          .selectFrom("rental_cases")
          .select("id")
          .where("id", "=", input.caseId)
          .where("owner_type", "=", input.actor.kind)
          .where("owner_subject_id", "=", actorSubject(input.actor))
          .where("status", "=", "deletion_pending")
          .where("deleted_at", "is not", null)
          .forUpdate()
          .executeTakeFirst();
        return pending !== undefined;
      }
      await transaction
        .updateTable("case_artifacts")
        .set({ state: "deletion_pending", deleted_at: input.now, updated_at: input.now })
        .where("case_id", "=", input.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("deleted_at", "is", null)
        .execute();
      await transaction
        .insertInto("deletion_requests")
        .values({
          id: `delete_${randomBytes(24).toString("base64url")}`,
          target_type: "case",
          target_id: input.caseId,
          requested_by_type: input.actor.kind,
          requested_by_subject_id: actorSubject(input.actor),
          status: "processing",
          requested_at: input.now,
          purge_deadline: new Date(
            input.now.getTime() + (input.actor.kind === "guest" ? 1 : 7) * 24 * 60 * 60 * 1000,
          ),
          attempt_count: 0,
          completed_at: null,
          correlation_id: `corr_${randomBytes(24).toString("base64url")}`,
          updated_at: input.now,
        })
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async completeCaseDeletion(
    input: Parameters<RealDemoRepositoryPort["completeCaseDeletion"]>[0],
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom("case_artifacts")
        .where("case_id", "=", input.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("state", "=", "deletion_pending")
        .execute();
      const deletedCase = await transaction
        .deleteFrom("rental_cases")
        .where("id", "=", input.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("status", "=", "deletion_pending")
        .where("deleted_at", "is not", null)
        .returning("id")
        .executeTakeFirst();
      if (!deletedCase) {
        throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
      }
      const completedRequest = await transaction
        .updateTable("deletion_requests")
        .set({ status: "completed", completed_at: input.now, updated_at: input.now })
        .where("target_type", "=", "case")
        .where("target_id", "=", input.caseId)
        .where("requested_by_type", "=", input.actor.kind)
        .where("requested_by_subject_id", "=", actorSubject(input.actor))
        .where("status", "=", "processing")
        .returning("id")
        .executeTakeFirst();
      if (!completedRequest) {
        throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
      }
    });
  }

  async listAvailableArtifacts(
    input: Parameters<RealDemoRepositoryPort["listAvailableArtifacts"]>[0],
  ) {
    const rows = await this.database
      .selectFrom("case_artifacts")
      .innerJoin("rental_cases", "rental_cases.id", "case_artifacts.case_id")
      .select([
        "case_artifacts.id as artifact_id",
        "case_artifacts.case_id",
        "case_artifacts.artifact_kind",
        "case_artifacts.mime",
        "case_artifacts.derivative_relative_path",
        "case_artifacts.extracted_text_relative_path",
      ])
      .where("case_artifacts.case_id", "=", input.caseId)
      .where("case_artifacts.owner_type", "=", input.actor.kind)
      .where("case_artifacts.owner_subject_id", "=", actorSubject(input.actor))
      .where("case_artifacts.state", "=", "available")
      .where("case_artifacts.deleted_at", "is", null)
      .where("rental_cases.owner_type", "=", input.actor.kind)
      .where("rental_cases.owner_subject_id", "=", actorSubject(input.actor))
      .where("rental_cases.deleted_at", "is", null)
      .orderBy("case_artifacts.created_at", "asc")
      .execute();
    if (rows.length === 0) {
      const owned = await this.database
        .selectFrom("rental_cases")
        .select("id")
        .where("id", "=", input.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!owned) throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
    }
    return rows.map((row) => ({
      artifactId: row.artifact_id,
      caseId: row.case_id,
      kind: row.artifact_kind,
      mime: row.mime,
      derivativeRelativePath: row.derivative_relative_path,
      extractedTextRelativePath: row.extracted_text_relative_path,
    }));
  }

  async commitAnalysis(input: Parameters<RealDemoRepositoryPort["commitAnalysis"]>[0]) {
    await this.database.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("rental_cases")
        .select(["id", "state"])
        .where("id", "=", input.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("deleted_at", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!current || !isPlainObject(current.state)) {
        throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
      }
      const currentState = current.state;
      await transaction
        .updateTable("rental_cases")
        .set((expression) => ({
          state: { ...currentState, analysisSnapshot: input.snapshot },
          status: "ready",
          active_snapshot_id: input.snapshot.snapshotId,
          revision: expression("revision", "+", 1),
          updated_at: input.now,
        }))
        .where("id", "=", input.caseId)
        .where("owner_type", "=", input.actor.kind)
        .where("owner_subject_id", "=", actorSubject(input.actor))
        .where("deleted_at", "is", null)
        .executeTakeFirstOrThrow();
    });
  }
}

function postgresCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const value = Reflect.get(error, "code") as unknown;
  return typeof value === "string" ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actorSubject(actor: ActorContext): string {
  // Guest ownership is deliberately bound to the one browser session, not merely
  // to the longer-lived guest identity. This keeps a future second session for the
  // same identity from inheriting access to the first session's private case.
  return actor.kind === "user" ? actor.userId : actor.guestSessionId;
}
