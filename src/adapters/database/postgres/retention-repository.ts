import { type Kysely } from "kysely";
import type { ClaimedRetentionTarget, RetentionRepositoryPort } from "@/application/retention";
import type { RentProofDatabase } from "./database";

const DAY_MS = 24 * 60 * 60 * 1_000;

export class PostgresRetentionRepository implements RetentionRepositoryPort {
  constructor(private readonly database: Kysely<RentProofDatabase>) {}

  async claimNext(
    now: Date,
    excludedClaimIds: readonly string[],
  ): Promise<ClaimedRetentionTarget | null> {
    return this.database.transaction().execute(async (transaction) => {
      let guestQuery = transaction
        .selectFrom("guest_identities")
        .select("id")
        .where("expires_at", "<=", now)
        .where("purge_state", "in", ["active", "pending"]);
      const excludedGuestIds = excludedClaimIds
        .filter((id) => id.startsWith("guest:"))
        .map((id) => id.slice("guest:".length));
      if (excludedGuestIds.length > 0)
        guestQuery = guestQuery.where("id", "not in", excludedGuestIds);
      const guest = await guestQuery
        .orderBy("expires_at", "asc")
        .forUpdate()
        .skipLocked()
        .limit(1)
        .executeTakeFirst();
      if (guest) {
        await transaction
          .updateTable("guest_identities")
          .set({ purge_state: "pending" })
          .where("id", "=", guest.id)
          .executeTakeFirstOrThrow();
        const sessions = await transaction
          .selectFrom("guest_sessions")
          .select("id")
          .where("guest_id", "=", guest.id)
          .execute();
        const sessionIds = sessions.map((session) => session.id);
        const cases =
          sessionIds.length === 0
            ? []
            : await transaction
                .selectFrom("rental_cases")
                .select("id")
                .where("owner_type", "=", "guest")
                .where("owner_subject_id", "in", sessionIds)
                .execute();
        return {
          claimId: `guest:${guest.id}`,
          kind: "guest",
          targetId: guest.id,
          caseIds: cases.map((item) => item.id),
        };
      }

      let requestQuery = transaction
        .selectFrom("deletion_requests")
        .select(["id", "target_type", "target_id", "requested_by_type", "requested_by_subject_id"])
        .where("status", "in", ["pending", "failed"]);
      const excludedRequestIds = excludedClaimIds.filter((id) => !id.startsWith("guest:"));
      if (excludedRequestIds.length > 0) {
        requestQuery = requestQuery.where("id", "not in", excludedRequestIds);
      }
      const request = await requestQuery
        .orderBy("requested_at", "asc")
        .forUpdate()
        .skipLocked()
        .limit(1)
        .executeTakeFirst();
      if (!request) return null;
      if (request.target_type === "case") {
        const target = await transaction
          .selectFrom("rental_cases")
          .select("id")
          .where("id", "=", request.target_id)
          .where("owner_type", "=", request.requested_by_type)
          .where("owner_subject_id", "=", request.requested_by_subject_id)
          .where("status", "=", "deletion_pending")
          .where("deleted_at", "is not", null)
          .forUpdate()
          .executeTakeFirst();
        if (!target) {
          await transaction
            .updateTable("deletion_requests")
            .set({ status: "failed", updated_at: now })
            .where("id", "=", request.id)
            .execute();
          return null;
        }
      } else {
        const target = await transaction
          .selectFrom("internal_users")
          .select("id")
          .where("id", "=", request.target_id)
          .where("status", "=", "deletion_pending")
          .forUpdate()
          .executeTakeFirst();
        if (!target || request.requested_by_subject_id !== request.target_id) {
          await transaction
            .updateTable("deletion_requests")
            .set({ status: "failed", updated_at: now })
            .where("id", "=", request.id)
            .execute();
          return null;
        }
      }
      await transaction
        .updateTable("deletion_requests")
        .set((expression) => ({
          status: "processing",
          attempt_count: expression("attempt_count", "+", 1),
          updated_at: now,
        }))
        .where("id", "=", request.id)
        .where("status", "in", ["pending", "failed"])
        .executeTakeFirstOrThrow();
      const cases =
        request.target_type === "case"
          ? [{ id: request.target_id }]
          : await transaction
              .selectFrom("rental_cases")
              .select("id")
              .where("owner_type", "=", "user")
              .where("owner_subject_id", "=", request.target_id)
              .execute();
      return {
        claimId: request.id,
        kind: request.target_type,
        targetId: request.target_id,
        caseIds: cases.map((item) => item.id),
      };
    });
  }

  async complete(target: ClaimedRetentionTarget, now: Date): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      if (target.caseIds.length > 0) {
        await transaction
          .deleteFrom("case_artifacts")
          .where("case_id", "in", target.caseIds)
          .execute();
        await transaction
          .deleteFrom("policy_events")
          .where("case_id", "in", target.caseIds)
          .execute();
        const deletedCases = await transaction
          .deleteFrom("rental_cases")
          .where("id", "in", target.caseIds)
          .executeTakeFirst();
        if (Number(deletedCases.numDeletedRows) !== target.caseIds.length) {
          throw new Error("CASE_PURGE_STATE_CHANGED");
        }
      }
      if (target.kind === "guest") {
        const sessions = await transaction
          .selectFrom("guest_sessions")
          .select("id")
          .where("guest_id", "=", target.targetId)
          .execute();
        const sessionIds = sessions.map((session) => session.id);
        if (sessionIds.length > 0) {
          await transaction
            .deleteFrom("policy_events")
            .where("actor_type", "=", "guest")
            .where("actor_subject_id", "in", sessionIds)
            .execute();
          await transaction
            .deleteFrom("consent_preferences")
            .where("actor_type", "=", "guest")
            .where("actor_subject_id", "in", sessionIds)
            .execute();
        }
        const deletedGuest = await transaction
          .deleteFrom("guest_identities")
          .where("id", "=", target.targetId)
          .where("purge_state", "=", "pending")
          .executeTakeFirstOrThrow();
        if (Number(deletedGuest.numDeletedRows) !== 1) throw new Error("GUEST_PURGE_STATE_CHANGED");
        return;
      }
      if (target.kind === "account") {
        await transaction
          .deleteFrom("policy_events")
          .where("actor_type", "=", "user")
          .where("actor_subject_id", "=", target.targetId)
          .execute();
        await transaction
          .deleteFrom("consent_preferences")
          .where("actor_type", "=", "user")
          .where("actor_subject_id", "=", target.targetId)
          .execute();
        const deletedAccount = await transaction
          .deleteFrom("internal_users")
          .where("id", "=", target.targetId)
          .where("status", "=", "deletion_pending")
          .executeTakeFirst();
        if (Number(deletedAccount.numDeletedRows) !== 1)
          throw new Error("ACCOUNT_PURGE_STATE_CHANGED");
      }
      await transaction
        .updateTable("deletion_requests")
        .set({ status: "completed", completed_at: now, updated_at: now })
        .where("id", "=", target.claimId)
        .where("target_type", "=", target.kind)
        .where("target_id", "=", target.targetId)
        .where("status", "=", "processing")
        .executeTakeFirstOrThrow();
    });
  }

  async fail(target: ClaimedRetentionTarget, now: Date): Promise<void> {
    if (target.kind === "guest") {
      await this.database
        .updateTable("guest_identities")
        .set({ purge_state: "pending" })
        .where("id", "=", target.targetId)
        .execute();
      return;
    }
    await this.database
      .updateTable("deletion_requests")
      .set({ status: "failed", updated_at: now })
      .where("id", "=", target.claimId)
      .where("status", "=", "processing")
      .execute();
  }

  async purgeExpiredMetadata(now: Date): Promise<{
    deletionTombstones: number;
    securityAuditEvents: number;
  }> {
    const tombstones = await this.database
      .deleteFrom("deletion_requests")
      .where("status", "=", "completed")
      .where("completed_at", "<=", new Date(now.getTime() - 21 * DAY_MS))
      .executeTakeFirst();
    const audits = await this.database
      .deleteFrom("security_audit_events")
      .where("occurred_at", "<=", new Date(now.getTime() - 180 * DAY_MS))
      .executeTakeFirst();
    return {
      deletionTombstones: Number(tombstones.numDeletedRows),
      securityAuditEvents: Number(audits.numDeletedRows),
    };
  }
}
