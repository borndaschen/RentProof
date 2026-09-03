import { Kysely, PostgresDialect } from "kysely";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import type { RentProofDatabase } from "./database";
import { PostgresRetentionRepository } from "./retention-repository";

const now = new Date("2026-09-03T12:00:00.000Z");

describe("PostgresRetentionRepository", () => {
  it("claims an expired guest together with every session-owned case", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue(
      [{ id: "guest_a" }],
      [],
      [{ id: "guest_session_a" }],
      [{ id: "case_a" }, { id: "case_b" }],
    );
    await expect(
      new PostgresRetentionRepository(fixture.database).claimNext(now, []),
    ).resolves.toEqual({
      claimId: "guest:guest_a",
      kind: "guest",
      targetId: "guest_a",
      caseIds: ["case_a", "case_b"],
    });
    expect(fixture.pool.queries.some((query) => query.text.includes("skip locked"))).toBe(true);
    await fixture.destroy();
  });

  it("claims and retries a case deletion request without broadening its target", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue(
      [],
      [
        {
          id: "delete_a",
          target_type: "case",
          target_id: "case_a",
          requested_by_type: "user",
          requested_by_subject_id: "user_a",
        },
      ],
      [{ id: "case_a" }],
      [],
    );
    const repository = new PostgresRetentionRepository(fixture.database);
    const target = await repository.claimNext(now, []);
    expect(target).toEqual({
      claimId: "delete_a",
      kind: "case",
      targetId: "case_a",
      caseIds: ["case_a"],
    });
    fixture.pool.enqueue([]);
    if (!target) throw new Error("TARGET_MISSING");
    await repository.fail(target, now);
    expect(fixture.pool.queries.at(-1)?.text).toContain('"status" = $1');
    await fixture.destroy();
  });

  it("excludes targets already attempted in the current batch", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue([], []);
    await expect(
      new PostgresRetentionRepository(fixture.database).claimNext(now, [
        "guest:guest_a",
        "delete_a",
      ]),
    ).resolves.toBeNull();
    const queries = fixture.pool.queries.filter((query) => query.text.includes("not in"));
    expect(queries).toHaveLength(2);
    await fixture.destroy();
  });

  it("purges guest content only after private files have been handled by the service", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue([], [], [{}], [{ id: "guest_session_a" }], [], [], [{}]);
    const repository = new PostgresRetentionRepository(fixture.database);
    await repository.complete(
      {
        claimId: "guest:guest_a",
        kind: "guest",
        targetId: "guest_a",
        caseIds: ["case_a"],
      },
      now,
    );
    expect(
      fixture.pool.queries.some((query) => query.text.includes('delete from "case_artifacts"')),
    ).toBe(true);
    expect(
      fixture.pool.queries.some((query) => query.text.includes('delete from "guest_identities"')),
    ).toBe(true);
    await fixture.destroy();
  });

  it("keeps a failed guest purge pending for the next scheduled run", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue([]);
    await new PostgresRetentionRepository(fixture.database).fail(
      { claimId: "guest:guest_a", kind: "guest", targetId: "guest_a", caseIds: [] },
      now,
    );
    expect(fixture.pool.queries.at(-1)?.text).toContain('update "guest_identities"');
    await fixture.destroy();
  });

  it("purges account-owned cases and credentials while retaining a completed tombstone", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue([], [], [{}], [], [], [{}], []);
    const repository = new PostgresRetentionRepository(fixture.database);
    await repository.complete(
      {
        claimId: "delete_account_a",
        kind: "account",
        targetId: "user_a",
        caseIds: ["case_a"],
      },
      now,
    );
    expect(
      fixture.pool.queries.some((query) => query.text.includes('delete from "internal_users"')),
    ).toBe(true);
    expect(
      fixture.pool.queries.some((query) => query.text.includes('update "deletion_requests"')),
    ).toBe(true);
    await fixture.destroy();
  });

  it("removes content-free deletion tombstones after 21 days and audit metadata after 180", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue([], []);
    const result = await new PostgresRetentionRepository(fixture.database).purgeExpiredMetadata(
      now,
    );
    expect(result).toEqual({ deletionTombstones: 0, securityAuditEvents: 0 });
    const parameters = fixture.pool.queries.flatMap((query) => query.parameters);
    expect(parameters).toContainEqual(new Date(now.getTime() - 21 * 24 * 60 * 60 * 1_000));
    expect(parameters).toContainEqual(new Date(now.getTime() - 180 * 24 * 60 * 60 * 1_000));
    await fixture.destroy();
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
