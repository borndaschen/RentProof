import { Kysely, PostgresDialect } from "kysely";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import type { RentProofDatabase } from "./database";
import { PostgresSelfHostedAuthRepository } from "./self-hosted-auth-repository";
import { createInstalledArgon2idPasswordHasher } from "@/adapters/auth/self-hosted";

const digest = "a".repeat(64);
const passwordHash = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnaWVzdA";
const now = new Date("2026-09-03T00:00:00.000Z");
const expiry = new Date("2026-09-10T00:00:00.000Z");

describe("PostgresSelfHostedAuthRepository", () => {
  it("accepts the installed Argon2id PHC parameter order while enforcing minimums", async () => {
    const fixture = createFixture();
    const hash = await createInstalledArgon2idPasswordHasher().hash("correct horse battery staple");
    fixture.pool.enqueue([], [{ user_id: "user_generated" }]);
    const repository = new PostgresSelfHostedAuthRepository(fixture.database);
    await expect(
      repository.createAccount({
        normalizedEmail: "synthetic@example.invalid",
        passwordHash: hash,
        now,
      }),
    ).resolves.toMatchObject({ status: "created" });
    expect(hash).toContain("m=19456,p=1,t=2");
    await fixture.database.destroy();
  });

  it("touches an active session and its seven-day idle expiry in one atomic statement", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue([
      {
        id: "session_abcdefghijklmnopq",
        user_id: "user_abcdefghijklmnopqrst",
        idle_expires_at: expiry,
        reverified_until: null,
      },
    ]);
    const repository = new PostgresSelfHostedAuthRepository(fixture.database);
    await expect(
      repository.resolveAndTouchSession({ tokenDigest: digest, now, idleExpiresAt: expiry }),
    ).resolves.toEqual({
      sessionId: "session_abcdefghijklmnopq",
      userId: "user_abcdefghijklmnopqrst",
      idleExpiresAt: expiry,
      reverifiedUntil: null,
    });
    const query = fixture.pool.queries[0];
    expect(query?.text).toContain('update "auth_sessions"');
    expect(query?.text).toContain('"revoked_at" is null');
    expect(query?.text).toContain('"idle_expires_at" >');
    expect(query?.text).toContain('"status" =');
    expect(query?.parameters).toContain(digest);
    await fixture.database.destroy();
  });

  it("returns signed-out state for expired, revoked, or disabled-user sessions without a second query", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue([]);
    const repository = new PostgresSelfHostedAuthRepository(fixture.database);
    await expect(
      repository.resolveAndTouchSession({ tokenDigest: digest, now, idleExpiresAt: expiry }),
    ).resolves.toBeNull();
    expect(fixture.pool.queries).toHaveLength(1);
    await fixture.database.destroy();
  });

  it("rotates the token after re-verification and makes the previous token a replay", async () => {
    const fixture = createFixture();
    const replacementDigest = "b".repeat(64);
    fixture.pool.enqueue(
      [{ id: "session_abcdefghijklmnopq" }],
      [],
      [
        {
          id: "session_replacementabcdef",
          user_id: "user_abcdefghijklmnopqrst",
          idle_expires_at: expiry,
          reverified_until: new Date("2026-09-03T00:15:00.000Z"),
        },
      ],
    );
    const repository = new PostgresSelfHostedAuthRepository(fixture.database);
    await expect(
      repository.rotateSessionAfterReverification({
        currentTokenDigest: digest,
        replacementTokenDigest: replacementDigest,
        userId: "user_abcdefghijklmnopqrst",
        now,
        idleExpiresAt: expiry,
        reverifiedUntil: new Date("2026-09-03T00:15:00.000Z"),
      }),
    ).resolves.toMatchObject({ sessionId: "session_replacementabcdef" });
    fixture.pool.enqueue([]);
    await expect(
      repository.rotateSessionAfterReverification({
        currentTokenDigest: digest,
        replacementTokenDigest: "c".repeat(64),
        userId: "user_abcdefghijklmnopqrst",
        now,
        idleExpiresAt: expiry,
        reverifiedUntil: new Date("2026-09-03T00:15:00.000Z"),
      }),
    ).resolves.toBeNull();
    const sql = fixture.pool.queries.map((query) => query.text).join("\n");
    expect(sql).toMatch(/for update/iu);
    expect(sql).toContain('insert into "auth_sessions"');
    expect(fixture.pool.queries.flatMap((query) => query.parameters)).toContain(replacementDigest);
    await fixture.database.destroy();
  });

  it("consumes reset, changes password, and revokes every user session in one transaction", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue(
      [{ id: "reset_abcdefghijklmnopqr", user_id: "user_abcdefghijklmnopqrst" }],
      [{ id: "reset_abcdefghijklmnopqr" }],
      [],
      [],
    );
    const repository = new PostgresSelfHostedAuthRepository(fixture.database);
    await expect(
      repository.consumePasswordResetChallenge({
        tokenDigest: digest,
        passwordHash,
        now,
      }),
    ).resolves.toEqual({ status: "completed", userId: "user_abcdefghijklmnopqrst" });
    const sql = fixture.pool.queries.map((query) => query.text).join("\n");
    expect(sql).toMatch(/for update/iu);
    expect(sql).toContain('"internal_users"."status" =');
    expect(sql).toContain('update "auth_credentials"');
    expect(sql).toContain('update "auth_sessions"');
    expect(sql).not.toContain("correct horse");
    await fixture.database.destroy();
  });

  it("prevents replay when a reset challenge is already consumed", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue([]);
    const repository = new PostgresSelfHostedAuthRepository(fixture.database);
    await expect(
      repository.consumePasswordResetChallenge({
        tokenDigest: digest,
        passwordHash,
        now,
      }),
    ).resolves.toEqual({ status: "invalid_or_expired" });
    expect(fixture.pool.queries.some((query) => query.text.includes('"auth_credentials"'))).toBe(
      false,
    );
    await fixture.database.destroy();
  });

  it("verifies Email once and rejects verification replay atomically", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue(
      [{ id: "verify_abcdefghijklmnop", user_id: "user_abcdefghijklmnopqrst" }],
      [{ id: "verify_abcdefghijklmnop" }],
      [],
      [],
    );
    const repository = new PostgresSelfHostedAuthRepository(fixture.database);
    await expect(
      repository.consumeEmailVerificationChallenge({ tokenDigest: digest, now }),
    ).resolves.toEqual({ status: "verified", userId: "user_abcdefghijklmnopqrst" });
    fixture.pool.enqueue([]);
    await expect(
      repository.consumeEmailVerificationChallenge({ tokenDigest: digest, now }),
    ).resolves.toEqual({ status: "invalid_or_expired" });
    const sql = fixture.pool.queries.map((query) => query.text).join("\n");
    expect(sql).toMatch(/for update/iu);
    expect(sql).toContain('update "auth_credentials"');
    expect(sql).toContain('update "internal_users"');
    await fixture.database.destroy();
  });

  it("disables the exact internal user and revokes only that user's sessions", async () => {
    const fixture = createFixture();
    fixture.pool.enqueue([{ id: "user_abcdefghijklmnopqrst" }], []);
    const repository = new PostgresSelfHostedAuthRepository(fixture.database);
    await expect(
      repository.disableAccountAndRevokeSessions("user_abcdefghijklmnopqrst", now),
    ).resolves.toBe(true);
    const parameters = fixture.pool.queries.flatMap((query) => query.parameters);
    expect(parameters).toContain("user_abcdefghijklmnopqrst");
    expect(parameters).not.toContain("user_otherabcdefghijkl");
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

function createFixture(): {
  pool: FakePool;
  database: Kysely<RentProofDatabase>;
} {
  const pool = new FakePool();
  const database = new Kysely<RentProofDatabase>({
    dialect: new PostgresDialect({ pool: pool as unknown as Pool }),
  });
  return { pool, database };
}
