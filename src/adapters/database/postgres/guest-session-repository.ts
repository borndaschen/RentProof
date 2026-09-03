import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import type { ActorContext } from "@/application/repositories";
import type { RentProofDatabase } from "./database";

export class PostgresGuestSessionRepository {
  constructor(private readonly database: Kysely<RentProofDatabase>) {}

  async create(tokenDigest: string, now: Date): Promise<ActorContext & { kind: "guest" }> {
    const guestId = `guest_${randomBytes(24).toString("hex")}`;
    const sessionId = `guest_session_${randomBytes(24).toString("hex")}`;
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("guest_identities")
        .values({ id: guestId, created_at: now, expires_at: expiresAt, purge_state: "active" })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("guest_sessions")
        .values({
          id: sessionId,
          guest_id: guestId,
          token_digest: tokenDigest,
          created_at: now,
          expires_at: expiresAt,
          revoked_at: null,
        })
        .executeTakeFirstOrThrow();
    });
    return { kind: "guest", guestId, guestSessionId: sessionId };
  }

  async resolve(
    tokenDigest: string,
    now: Date,
  ): Promise<(ActorContext & { kind: "guest" }) | null> {
    const row = await this.database
      .selectFrom("guest_sessions")
      .innerJoin("guest_identities", "guest_identities.id", "guest_sessions.guest_id")
      .select(["guest_sessions.id", "guest_sessions.guest_id"])
      .where("guest_sessions.token_digest", "=", tokenDigest)
      .where("guest_sessions.revoked_at", "is", null)
      .where("guest_sessions.expires_at", ">", now)
      .where("guest_identities.expires_at", ">", now)
      .where("guest_identities.purge_state", "=", "active")
      .executeTakeFirst();
    return row ? { kind: "guest", guestId: row.guest_id, guestSessionId: row.id } : null;
  }
}
