import { Kysely, PostgresDialect } from "kysely";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import type { RentProofDatabase } from "./database";
import { PostgresGuestSessionRepository } from "./guest-session-repository";

const now = new Date("2026-09-03T12:00:00.000Z");
const digest = "a".repeat(64);

describe("PostgresGuestSessionRepository", () => {
  it("creates one opaque guest identity and a fixed 24-hour session atomically", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue([], []);
    const repository = new PostgresGuestSessionRepository(fixture.database);

    const actor = await repository.create(digest, now);

    expect(actor.guestId).toMatch(/^guest_[a-f0-9]{48}$/u);
    expect(actor.guestSessionId).toMatch(/^guest_session_[a-f0-9]{48}$/u);
    const identityInsert = fixture.pool.queries.find((query) =>
      query.text.includes('insert into "guest_identities"'),
    );
    const sessionInsert = fixture.pool.queries.find((query) =>
      query.text.includes('insert into "guest_sessions"'),
    );
    const expiry = new Date("2026-09-04T12:00:00.000Z");
    expect(identityInsert?.parameters.some((value) => sameInstant(value, expiry))).toBe(true);
    expect(sessionInsert?.parameters.some((value) => sameInstant(value, expiry))).toBe(true);
    expect(sessionInsert?.parameters).toContain(digest);
    expect(fixture.pool.queries.some((query) => /^commit$/iu.test(query.text.trim()))).toBe(true);
    await fixture.database.destroy();
  });

  it("resolves only an active, unexpired session and never slides its expiry", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue([
      {
        id: "guest_session_abcdefghijklmnopqrstuv",
        guest_id: "guest_abcdefghijklmnopqrstuvwxyz12345",
      },
    ]);
    const repository = new PostgresGuestSessionRepository(fixture.database);

    await expect(repository.resolve(digest, now)).resolves.toEqual({
      kind: "guest",
      guestId: "guest_abcdefghijklmnopqrstuvwxyz12345",
      guestSessionId: "guest_session_abcdefghijklmnopqrstuv",
    });
    const query = fixture.pool.queries[0];
    expect(query?.text).toContain('"guest_sessions"."expires_at" >');
    expect(query?.text).toContain('"guest_identities"."expires_at" >');
    expect(query?.text).toContain('"guest_sessions"."revoked_at" is null');
    expect(query?.text.toLowerCase()).not.toContain("update ");
    await fixture.database.destroy();
  });

  it("returns no actor for an expired, revoked, pending-purge, or unknown token", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue([]);
    const repository = new PostgresGuestSessionRepository(fixture.database);
    await expect(repository.resolve(digest, now)).resolves.toBeNull();
    expect(fixture.pool.queries).toHaveLength(1);
    await fixture.database.destroy();
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

function createFixture(): { pool: FakePool; database: Kysely<RentProofDatabase> } {
  const pool = new FakePool();
  const database = new Kysely<RentProofDatabase>({
    dialect: new PostgresDialect({ pool: pool as unknown as Pool }),
  });
  return { pool, database };
}

function sameInstant(value: unknown, expected: Date): boolean {
  return value instanceof Date && value.getTime() === expected.getTime();
}
