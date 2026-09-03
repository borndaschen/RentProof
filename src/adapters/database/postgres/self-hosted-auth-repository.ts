import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type {
  AccountCredential,
  AccountSessionRecord,
  SelfHostedAuthRepositoryPort,
} from "@/application/auth";
import { NormalizedEmailSchema, TokenDigestSchema } from "@/application/auth";
import type { RentProofDatabase } from "./database";

export class PostgresSelfHostedAuthRepository implements SelfHostedAuthRepositoryPort {
  constructor(private readonly database: Kysely<RentProofDatabase>) {}

  async createAccount(
    input: Readonly<{
      normalizedEmail: string;
      passwordHash: string;
      now: Date;
    }>,
  ): Promise<{ status: "created"; userId: string } | { status: "already_exists" }> {
    const normalizedEmail = NormalizedEmailSchema.parse(input.normalizedEmail);
    assertArgon2idHash(input.passwordHash);
    const userId = `user_${randomUUID().replaceAll("-", "")}`;
    try {
      await this.database.transaction().execute(async (transaction) => {
        await transaction
          .insertInto("internal_users")
          .values({
            id: userId,
            clerk_user_id: null,
            email_verified: false,
            status: "active",
            created_at: input.now,
            updated_at: input.now,
          })
          .executeTakeFirstOrThrow();
        const credential = await transaction
          .insertInto("auth_credentials")
          .values({
            user_id: userId,
            email_normalized: normalizedEmail,
            password_hash: input.passwordHash,
            password_updated_at: input.now,
            email_verified_at: null,
            created_at: input.now,
            updated_at: input.now,
          })
          .onConflict((conflict) => conflict.column("email_normalized").doNothing())
          .returning("user_id")
          .executeTakeFirst();
        if (!credential) throw new DuplicateEmailError();
      });
      return { status: "created", userId };
    } catch (error: unknown) {
      if (error instanceof DuplicateEmailError) return { status: "already_exists" };
      throw error;
    }
  }

  async findCredentialByEmail(normalizedEmail: string): Promise<AccountCredential | null> {
    const email = NormalizedEmailSchema.parse(normalizedEmail);
    const row = await this.database
      .selectFrom("auth_credentials")
      .innerJoin("internal_users", "internal_users.id", "auth_credentials.user_id")
      .select([
        "auth_credentials.user_id",
        "auth_credentials.email_normalized",
        "auth_credentials.password_hash",
        "auth_credentials.email_verified_at",
        "internal_users.status",
      ])
      .where("auth_credentials.email_normalized", "=", email)
      .executeTakeFirst();
    return row ? toCredential(row) : null;
  }

  async findCredentialByUserId(userId: string): Promise<AccountCredential | null> {
    const row = await this.database
      .selectFrom("auth_credentials")
      .innerJoin("internal_users", "internal_users.id", "auth_credentials.user_id")
      .select([
        "auth_credentials.user_id",
        "auth_credentials.email_normalized",
        "auth_credentials.password_hash",
        "auth_credentials.email_verified_at",
        "internal_users.status",
      ])
      .where("auth_credentials.user_id", "=", userId)
      .executeTakeFirst();
    return row ? toCredential(row) : null;
  }

  async replacePasswordHash(userId: string, passwordHash: string, now: Date): Promise<boolean> {
    assertArgon2idHash(passwordHash);
    const result = await this.database
      .updateTable("auth_credentials")
      .set({ password_hash: passwordHash, password_updated_at: now, updated_at: now })
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async createSession(
    input: Readonly<{
      userId: string;
      tokenDigest: string;
      now: Date;
      idleExpiresAt: Date;
    }>,
  ): Promise<AccountSessionRecord> {
    const tokenDigest = TokenDigestSchema.parse(input.tokenDigest);
    const sessionId = `session_${randomUUID().replaceAll("-", "")}`;
    const row = await this.database.transaction().execute(async (transaction) => {
      const active = await transaction
        .selectFrom("internal_users")
        .innerJoin("auth_credentials", "auth_credentials.user_id", "internal_users.id")
        .select("id")
        .where("id", "=", input.userId)
        .where("status", "=", "active")
        .where("auth_credentials.email_verified_at", "is not", null)
        .forUpdate()
        .executeTakeFirst();
      if (!active) throw new AuthStateChangedError();
      return transaction
        .insertInto("auth_sessions")
        .values({
          id: sessionId,
          user_id: input.userId,
          token_digest: tokenDigest,
          created_at: input.now,
          last_used_at: input.now,
          idle_expires_at: input.idleExpiresAt,
          reverified_until: null,
          revoked_at: null,
        })
        .returning(["id", "user_id", "idle_expires_at", "reverified_until"])
        .executeTakeFirstOrThrow();
    });
    return toSession(row);
  }

  async resolveAndTouchSession(
    input: Readonly<{
      tokenDigest: string;
      now: Date;
      idleExpiresAt: Date;
    }>,
  ): Promise<AccountSessionRecord | null> {
    const tokenDigest = TokenDigestSchema.parse(input.tokenDigest);
    const activeUsers = this.database
      .selectFrom("internal_users")
      .select("id")
      .where("status", "=", "active");
    const row = await this.database
      .updateTable("auth_sessions")
      .set((expression) => ({
        last_used_at: input.now,
        idle_expires_at: input.idleExpiresAt,
        version: expression("version", "+", 1),
      }))
      .where("token_digest", "=", tokenDigest)
      .where("revoked_at", "is", null)
      .where("idle_expires_at", ">", input.now)
      .where("user_id", "in", activeUsers)
      .returning(["id", "user_id", "idle_expires_at", "reverified_until"])
      .executeTakeFirst();
    return row ? toSession(row) : null;
  }

  async resolveSessionWithoutTouch(
    input: Readonly<{ tokenDigest: string; now: Date }>,
  ): Promise<AccountSessionRecord | null> {
    const row = await this.database
      .selectFrom("auth_sessions")
      .innerJoin("internal_users", "internal_users.id", "auth_sessions.user_id")
      .select([
        "auth_sessions.id",
        "auth_sessions.user_id",
        "auth_sessions.idle_expires_at",
        "auth_sessions.reverified_until",
      ])
      .where("auth_sessions.token_digest", "=", TokenDigestSchema.parse(input.tokenDigest))
      .where("auth_sessions.revoked_at", "is", null)
      .where("auth_sessions.idle_expires_at", ">", input.now)
      .where("internal_users.status", "=", "active")
      .executeTakeFirst();
    return row ? toSession(row) : null;
  }

  async rotateSessionAfterReverification(
    input: Readonly<{
      currentTokenDigest: string;
      replacementTokenDigest: string;
      userId: string;
      now: Date;
      idleExpiresAt: Date;
      reverifiedUntil: Date;
    }>,
  ): Promise<AccountSessionRecord | null> {
    return this.database.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("auth_sessions")
        .select("id")
        .where("token_digest", "=", TokenDigestSchema.parse(input.currentTokenDigest))
        .where("user_id", "=", input.userId)
        .where("revoked_at", "is", null)
        .where("idle_expires_at", ">", input.now)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return null;
      await transaction
        .updateTable("auth_sessions")
        .set({ revoked_at: input.now })
        .where("id", "=", current.id)
        .where("revoked_at", "is", null)
        .executeTakeFirstOrThrow();
      const replacement = await transaction
        .insertInto("auth_sessions")
        .values({
          id: `session_${randomUUID().replaceAll("-", "")}`,
          user_id: input.userId,
          token_digest: TokenDigestSchema.parse(input.replacementTokenDigest),
          created_at: input.now,
          last_used_at: input.now,
          idle_expires_at: input.idleExpiresAt,
          reverified_until: input.reverifiedUntil,
          revoked_at: null,
        })
        .returning(["id", "user_id", "idle_expires_at", "reverified_until"])
        .executeTakeFirstOrThrow();
      return toSession(replacement);
    });
  }

  async revokeSession(tokenDigest: string, now: Date): Promise<void> {
    await this.database
      .updateTable("auth_sessions")
      .set({ revoked_at: now })
      .where("token_digest", "=", TokenDigestSchema.parse(tokenDigest))
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeAllUserSessions(userId: string, now: Date): Promise<void> {
    await this.database
      .updateTable("auth_sessions")
      .set({ revoked_at: now })
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .execute();
  }

  async createEmailVerificationChallenge(
    input: Readonly<{
      userId: string;
      tokenDigest: string;
      now: Date;
      expiresAt: Date;
    }>,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const active = await transaction
        .selectFrom("internal_users")
        .innerJoin("auth_credentials", "auth_credentials.user_id", "internal_users.id")
        .select("id")
        .where("id", "=", input.userId)
        .where("status", "=", "active")
        .where("auth_credentials.email_verified_at", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!active) return;
      await transaction
        .updateTable("auth_email_verification_challenges")
        .set({ consumed_at: input.now })
        .where("user_id", "=", input.userId)
        .where("consumed_at", "is", null)
        .execute();
      await transaction
        .insertInto("auth_email_verification_challenges")
        .values({
          id: `verify_${randomUUID().replaceAll("-", "")}`,
          user_id: input.userId,
          token_digest: TokenDigestSchema.parse(input.tokenDigest),
          created_at: input.now,
          expires_at: input.expiresAt,
          consumed_at: null,
        })
        .executeTakeFirstOrThrow();
    });
  }

  async consumeEmailVerificationChallenge(
    input: Readonly<{ tokenDigest: string; now: Date }>,
  ): Promise<{ status: "verified"; userId: string } | { status: "invalid_or_expired" }> {
    return this.database.transaction().execute(async (transaction) => {
      const challenge = await transaction
        .selectFrom("auth_email_verification_challenges")
        .innerJoin(
          "internal_users",
          "internal_users.id",
          "auth_email_verification_challenges.user_id",
        )
        .select([
          "auth_email_verification_challenges.id",
          "auth_email_verification_challenges.user_id",
        ])
        .where(
          "auth_email_verification_challenges.token_digest",
          "=",
          TokenDigestSchema.parse(input.tokenDigest),
        )
        .where("auth_email_verification_challenges.consumed_at", "is", null)
        .where("auth_email_verification_challenges.expires_at", ">", input.now)
        .where("auth_email_verification_challenges.attempt_count", "<", 5)
        .where("internal_users.status", "=", "active")
        .forUpdate()
        .executeTakeFirst();
      if (!challenge) return { status: "invalid_or_expired" };
      const consumed = await transaction
        .updateTable("auth_email_verification_challenges")
        .set({ consumed_at: input.now })
        .where("id", "=", challenge.id)
        .where("consumed_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!consumed) return { status: "invalid_or_expired" };
      await transaction
        .updateTable("auth_credentials")
        .set({ email_verified_at: input.now, updated_at: input.now })
        .where("user_id", "=", challenge.user_id)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("internal_users")
        .set({ email_verified: true, updated_at: input.now })
        .where("id", "=", challenge.user_id)
        .where("status", "=", "active")
        .executeTakeFirstOrThrow();
      return { status: "verified", userId: challenge.user_id };
    });
  }

  async createPasswordResetChallenge(
    input: Readonly<{
      userId: string;
      tokenDigest: string;
      now: Date;
      expiresAt: Date;
    }>,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const active = await transaction
        .selectFrom("internal_users")
        .innerJoin("auth_credentials", "auth_credentials.user_id", "internal_users.id")
        .select("id")
        .where("id", "=", input.userId)
        .where("status", "=", "active")
        .where("auth_credentials.email_verified_at", "is not", null)
        .forUpdate()
        .executeTakeFirst();
      if (!active) return;
      await transaction
        .updateTable("auth_password_reset_challenges")
        .set({ consumed_at: input.now })
        .where("user_id", "=", input.userId)
        .where("consumed_at", "is", null)
        .execute();
      await transaction
        .insertInto("auth_password_reset_challenges")
        .values({
          id: `reset_${randomUUID().replaceAll("-", "")}`,
          user_id: input.userId,
          token_digest: TokenDigestSchema.parse(input.tokenDigest),
          created_at: input.now,
          expires_at: input.expiresAt,
          consumed_at: null,
        })
        .executeTakeFirstOrThrow();
    });
  }

  async consumePasswordResetChallenge(
    input: Readonly<{
      tokenDigest: string;
      passwordHash: string;
      now: Date;
    }>,
  ): Promise<{ status: "completed"; userId: string } | { status: "invalid_or_expired" }> {
    assertArgon2idHash(input.passwordHash);
    return this.database.transaction().execute(async (transaction) => {
      const challenge = await transaction
        .selectFrom("auth_password_reset_challenges")
        .innerJoin("internal_users", "internal_users.id", "auth_password_reset_challenges.user_id")
        .select(["auth_password_reset_challenges.id", "auth_password_reset_challenges.user_id"])
        .where(
          "auth_password_reset_challenges.token_digest",
          "=",
          TokenDigestSchema.parse(input.tokenDigest),
        )
        .where("auth_password_reset_challenges.consumed_at", "is", null)
        .where("auth_password_reset_challenges.expires_at", ">", input.now)
        .where("auth_password_reset_challenges.attempt_count", "<", 5)
        .where("internal_users.status", "=", "active")
        .forUpdate()
        .executeTakeFirst();
      if (!challenge) return { status: "invalid_or_expired" };

      const consumed = await transaction
        .updateTable("auth_password_reset_challenges")
        .set({ consumed_at: input.now })
        .where("id", "=", challenge.id)
        .where("consumed_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!consumed) return { status: "invalid_or_expired" };
      await transaction
        .updateTable("auth_credentials")
        .set({
          password_hash: input.passwordHash,
          password_updated_at: input.now,
          updated_at: input.now,
        })
        .where("user_id", "=", challenge.user_id)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("auth_sessions")
        .set({ revoked_at: input.now })
        .where("user_id", "=", challenge.user_id)
        .where("revoked_at", "is", null)
        .execute();
      return { status: "completed", userId: challenge.user_id };
    });
  }

  async disableAccountAndRevokeSessions(userId: string, now: Date): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const user = await transaction
        .updateTable("internal_users")
        .set({ status: "disabled", updated_at: now })
        .where("id", "=", userId)
        .where("status", "=", "active")
        .returning("id")
        .executeTakeFirst();
      if (!user) return false;
      await transaction
        .updateTable("auth_sessions")
        .set({ revoked_at: now })
        .where("user_id", "=", userId)
        .where("revoked_at", "is", null)
        .execute();
      return true;
    });
  }
}

class DuplicateEmailError extends Error {}
class AuthStateChangedError extends Error {}

function assertArgon2idHash(passwordHash: string): void {
  const match = /^\$argon2id\$v=19\$([^$]+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u.exec(passwordHash);
  if (!match?.[1]) {
    throw new Error("PASSWORD_HASH_INVALID");
  }
  const parameters = new Map<string, number>();
  for (const entry of match[1].split(",")) {
    const parameter = /^(m|t|p)=(\d+)$/u.exec(entry);
    const key = parameter?.[1];
    const rawValue = parameter?.[2];
    if (!key || !rawValue || parameters.has(key)) throw new Error("PASSWORD_HASH_INVALID");
    parameters.set(key, Number(rawValue));
  }
  if (
    parameters.size !== 3 ||
    (parameters.get("m") ?? 0) < 19_456 ||
    (parameters.get("t") ?? 0) < 2 ||
    (parameters.get("p") ?? 0) < 1
  ) {
    throw new Error("PASSWORD_HASH_INVALID");
  }
}

function toCredential(row: {
  user_id: string;
  email_normalized: string;
  password_hash: string;
  email_verified_at: Date | null;
  status: "active" | "disabled" | "deletion_pending";
}): AccountCredential {
  return {
    userId: row.user_id,
    normalizedEmail: row.email_normalized,
    passwordHash: row.password_hash,
    emailVerified: row.email_verified_at !== null,
    status: row.status,
  };
}

function toSession(row: {
  id: string;
  user_id: string;
  idle_expires_at: Date;
  reverified_until: Date | null;
}): AccountSessionRecord {
  return {
    sessionId: row.id,
    userId: row.user_id,
    idleExpiresAt: row.idle_expires_at,
    reverifiedUntil: row.reverified_until,
  };
}
