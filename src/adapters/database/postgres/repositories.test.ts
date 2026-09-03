import { Kysely, PostgresDialect } from "kysely";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { RentProofDatabase } from "./database";
import { PostgresCaseHistoryRepository } from "./history-repository";
import {
  PostgresCaseStateRepository,
  PostgresDeletionRepository,
  PostgresPolicyRecordRepository,
  PostgresRepositoryError,
  PostgresSecurityAuditRepository,
} from "./repositories";

const user = {
  kind: "user" as const,
  userId: "user_abcdefghijklmnopqrst",
  sessionId: "session_abcdefghijklmnopq",
};
const otherUser = {
  kind: "user" as const,
  userId: "user_zyxwvutsrqponmlkjih",
  sessionId: "session_zyxwvutsrqponmlkj",
};
const caseId = "case_abcdefghijklmnopqrstu";
const CaseStateSchema = z.object({ title: z.string(), phase: z.enum(["draft", "ready"]) }).strict();
type CaseState = z.infer<typeof CaseStateSchema>;

describe("PostgresCaseStateRepository", () => {
  it("creates, loads, and atomically updates only through owner-scoped SQL", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresCaseStateRepository<CaseState>(
      fixture.database,
      CaseStateSchema,
      "fixture",
    );
    fixture.pool.enqueue([{ revision: 0 }]);
    await expect(
      repository.create(user, caseId, { title: "虛構套房", phase: "draft" }),
    ).resolves.toEqual({ status: "created", revision: 0 });

    fixture.pool.enqueue([
      { id: caseId, revision: 0, state: { title: "虛構套房", phase: "draft" } },
    ]);
    await expect(repository.load(user, caseId)).resolves.toEqual({
      caseId,
      revision: 0,
      state: { title: "虛構套房", phase: "draft" },
    });

    fixture.pool.enqueue([{ revision: 1 }]);
    await expect(
      repository.saveAtomic(user, caseId, 0, { title: "虛構套房", phase: "ready" }),
    ).resolves.toEqual({ status: "saved", revision: 1 });

    const sensitiveQueries = fixture.pool.queries.filter((query) =>
      query.text.includes('"rental_cases"'),
    );
    expect(sensitiveQueries.some((query) => query.text.includes('"owner_type"'))).toBe(true);
    expect(sensitiveQueries.some((query) => query.text.includes('"owner_subject_id"'))).toBe(true);
    expect(sensitiveQueries.some((query) => query.parameters.includes(user.userId))).toBe(true);
    await fixture.destroy();
  });

  it("does not reveal whether an absent or other-owned case exists", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresCaseStateRepository(
      fixture.database,
      CaseStateSchema,
      "fixture",
    );
    fixture.pool.enqueue([]);
    await expect(repository.load(otherUser, caseId)).resolves.toBeNull();

    fixture.pool.enqueue([], []);
    await expect(
      repository.saveAtomic(otherUser, caseId, 0, { title: "不可見", phase: "ready" }),
    ).resolves.toEqual({ status: "not_found_or_forbidden" });
    await fixture.destroy();
  });

  it("distinguishes a visible stale revision and fails closed on invalid stored state", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresCaseStateRepository(fixture.database, CaseStateSchema, "live");
    fixture.pool.enqueue([], [{ revision: 4 }]);
    await expect(
      repository.saveAtomic(user, caseId, 3, { title: "案件", phase: "ready" }),
    ).resolves.toEqual({ status: "revision_conflict" });

    fixture.pool.enqueue([{ id: caseId, revision: 4, state: { title: "案件", phase: "unknown" } }]);
    await expect(repository.load(user, caseId)).rejects.toMatchObject({
      code: "POSTGRES_STORED_STATE_INVALID",
    });
    await fixture.destroy();
  });

  it("validates actors, case IDs, state, and revisions before querying", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresCaseStateRepository(
      fixture.database,
      CaseStateSchema,
      "fixture",
    );
    await expect(repository.load({ kind: "user" } as never, caseId)).rejects.toMatchObject({
      code: "POSTGRES_REPOSITORY_INPUT_INVALID",
    });
    await expect(repository.load(user, "guessable")).rejects.toMatchObject({
      code: "POSTGRES_REPOSITORY_INPUT_INVALID",
    });
    await expect(
      repository.create(user, caseId, { title: "bad", phase: "x" } as never),
    ).rejects.toMatchObject({ code: "POSTGRES_REPOSITORY_INPUT_INVALID" });
    await expect(
      repository.saveAtomic(user, caseId, -1, { title: "bad", phase: "draft" }),
    ).rejects.toMatchObject({ code: "POSTGRES_REPOSITORY_INPUT_INVALID" });
    expect(fixture.pool.queries).toHaveLength(0);
    await fixture.destroy();
  });
});

describe("PostgreSQL real-data repository slices", () => {
  it("lists and reads history only through user owner scope", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresCaseHistoryRepository(fixture.database);
    const updatedAt = new Date("2026-09-03T08:00:00.000Z");
    const createdAt = new Date("2026-09-03T07:00:00.000Z");
    fixture.pool.enqueue([
      { id: caseId, display_name: "虛構套房", status: "ready", updated_at: updatedAt },
    ]);
    await expect(repository.listOwned(user)).resolves.toEqual([
      {
        caseId,
        displayName: "虛構套房",
        status: "ready",
        updatedAt: updatedAt.toISOString(),
      },
    ]);
    fixture.pool.enqueue([
      {
        id: caseId,
        display_name: "虛構套房",
        status: "ready",
        revision: 3,
        source_mode: "fixture",
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ]);
    await expect(repository.findOwned(user, caseId)).resolves.toMatchObject({
      caseId,
      revision: 3,
    });
    const historyQueries = fixture.pool.queries.filter((query) =>
      query.text.includes('"rental_cases"'),
    );
    expect(historyQueries).toHaveLength(2);
    expect(historyQueries.every((query) => query.text.includes('"owner_subject_id"'))).toBe(true);
    expect(historyQueries.every((query) => query.parameters.includes(user.userId))).toBe(true);
    await fixture.destroy();
  });

  it("returns null rather than revealing another user's history case", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresCaseHistoryRepository(fixture.database);
    fixture.pool.enqueue([]);
    await expect(repository.findOwned(otherUser, caseId)).resolves.toBeNull();
    expect(fixture.pool.queries[0]?.parameters).toContain(otherUser.userId);
    await fixture.destroy();
  });

  it("owner-checks case-bound policy events and upserts independent cookie purposes", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresPolicyRecordRepository(fixture.database);
    fixture.pool.enqueue([{ id: "policy_abcdefghijklmnopqr" }], [{ id: caseId }], []);
    await repository.appendPolicyEvent(user, {
      eventId: "event_abcdefghijklmnopqrs",
      policyDocumentId: "policy_abcdefghijklmnopqr",
      eventType: "consented",
      occurredAt: "2026-09-03T10:00:00+08:00",
      sourceRoute: "/api/cases/consent",
      caseId,
      processorListVersion: "processors-v1",
      auditRef: "audit_abcdefghijklmnopqrs",
    });
    fixture.pool.enqueue([]);
    await repository.saveConsentPreference(user, {
      purposeKey: "analytics",
      decision: "declined",
      cookiePolicyVersion: "draft-v1",
      inventoryVersion: "inventory-v1",
      occurredAt: "2026-09-03T10:01:00+08:00",
    });
    expect(fixture.pool.queries.some((query) => query.text.includes('"policy_events"'))).toBe(true);
    expect(fixture.pool.queries.some((query) => query.text.includes('"consent_preferences"'))).toBe(
      true,
    );
    await fixture.destroy();
  });

  it("rejects a policy event when the actor does not own its case", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresPolicyRecordRepository(fixture.database);
    fixture.pool.enqueue([{ id: "policy_abcdefghijklmnopqr" }], []);
    await expect(
      repository.appendPolicyEvent(otherUser, {
        eventId: "event_abcdefghijklmnopqrs",
        policyDocumentId: "policy_abcdefghijklmnopqr",
        eventType: "acknowledged",
        occurredAt: "2026-09-03T10:00:00+08:00",
        sourceRoute: "/api/cases/consent",
        caseId,
        auditRef: "audit_abcdefghijklmnopqrs",
      }),
    ).rejects.toMatchObject({ code: "POSTGRES_NOT_FOUND_OR_FORBIDDEN" });
    expect(fixture.pool.queries.some((query) => query.text.includes('"policy_events"'))).toBe(
      false,
    );
    await fixture.destroy();
  });

  it("does not record an event for an unpublished or unknown policy document", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresPolicyRecordRepository(fixture.database);
    fixture.pool.enqueue([]);
    await expect(
      repository.appendPolicyEvent(user, {
        eventId: "event_abcdefghijklmnopqrs",
        policyDocumentId: "policy_abcdefghijklmnopqr",
        eventType: "accepted",
        occurredAt: "2026-09-03T10:00:00+08:00",
        sourceRoute: "/api/account/policy-events",
        auditRef: "audit_abcdefghijklmnopqrs",
      }),
    ).rejects.toMatchObject({ code: "POSTGRES_NOT_FOUND_OR_FORBIDDEN" });
    expect(fixture.pool.queries.some((query) => query.text.includes('"policy_events"'))).toBe(
      false,
    );
    await fixture.destroy();
  });

  it("creates a deletion request and hides the case in one transaction", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresDeletionRepository(fixture.database);
    fixture.pool.enqueue(
      [{ id: caseId, status: "ready" }],
      [{ id: "delete_abcdefghijklmnopqr" }],
      [],
    );
    await expect(
      repository.requestCaseDeletion(user, {
        deletionRequestId: "delete_abcdefghijklmnopqr",
        caseId,
        requestedAt: "2026-09-03T10:00:00+08:00",
        purgeDeadline: "2026-09-10T10:00:00+08:00",
        correlationId: "correlation_abcdefghijklmn",
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(fixture.pool.queries.some((query) => /for update/iu.test(query.text))).toBe(true);
    expect(fixture.pool.queries.some((query) => query.text.includes("deletion_pending"))).toBe(
      false,
    );
    expect(
      fixture.pool.queries.some((query) => query.parameters.includes("deletion_pending")),
    ).toBe(true);
    await fixture.destroy();
  });

  it("does not enqueue deletion for an invisible case and treats repeated requests idempotently", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresDeletionRepository(fixture.database);
    const input = {
      deletionRequestId: "delete_abcdefghijklmnopqr",
      caseId,
      requestedAt: "2026-09-03T10:00:00+08:00",
      purgeDeadline: "2026-09-10T10:00:00+08:00",
      correlationId: "correlation_abcdefghijklmn",
    } as const;
    fixture.pool.enqueue([]);
    await expect(repository.requestCaseDeletion(otherUser, input)).resolves.toEqual({
      status: "not_found_or_forbidden",
    });
    fixture.pool.enqueue([{ id: caseId, status: "deletion_pending" }]);
    await expect(repository.requestCaseDeletion(user, input)).resolves.toEqual({
      status: "already_pending",
    });
    await fixture.destroy();
  });

  it("appends only allowlisted minimal security audit fields", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresSecurityAuditRepository(fixture.database);
    fixture.pool.enqueue([]);
    await repository.appendSecurityEvent({
      eventId: "event_abcdefghijklmnopqrs",
      eventType: "authorization_denied",
      occurredAt: "2026-09-03T10:00:00+08:00",
      outcome: "failure",
      reasonCode: "OWNER_SCOPE_DENIED",
      correlationId: "correlation_abcdefghijklmn",
      actorRef: "actor_abcdefghijklmnopqrs",
      targetRef: caseId,
    });
    expect(fixture.pool.queries[0]?.text).toContain('"security_audit_events"');
    expect(fixture.pool.queries[0]?.text).not.toMatch(
      /body|email|prompt|output|address|filename/iu,
    );
    await fixture.destroy();
  });

  it("uses typed repository errors without leaking values", () => {
    expect(new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID").message).toBe(
      "POSTGRES_REPOSITORY_INPUT_INVALID",
    );
  });
});

type RecordedQuery = { text: string; parameters: readonly unknown[] };

class FakePool {
  readonly queries: RecordedQuery[] = [];
  readonly #responses: QueryResultRow[][] = [];

  enqueue(...rows: QueryResultRow[][]): void {
    this.#responses.push(...rows);
  }

  on(): this {
    return this;
  }

  async connect() {
    return {
      query: async (text: string, parameters: readonly unknown[] = []): Promise<QueryResult> => {
        this.queries.push({ text, parameters });
        const normalized = text.trim().toLowerCase();
        const rows =
          normalized === "begin" || normalized === "commit" || normalized === "rollback"
            ? []
            : (this.#responses.shift() ?? []);
        return {
          command: normalized.split(" ")[0]?.toUpperCase() ?? "UNKNOWN",
          rowCount: rows.length,
          oid: 0,
          fields: [],
          rows,
        };
      },
      release(): void {},
    };
  }

  async end(): Promise<void> {}
}

function createDatabaseFixture(): {
  pool: FakePool;
  database: Kysely<RentProofDatabase>;
  destroy(): Promise<void>;
} {
  const pool = new FakePool();
  const database = new Kysely<RentProofDatabase>({
    dialect: new PostgresDialect({ pool: pool as unknown as Pool }),
  });
  return { pool, database, destroy: () => database.destroy() };
}
