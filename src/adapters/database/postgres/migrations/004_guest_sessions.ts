import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Frozen, forward-only migration. Do not import current application code.
export const guestSessionsMigration: Migration = {
  async up(database: Kysely<unknown>): Promise<void> {
    await database.schema
      .createTable("guest_sessions")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("guest_id", "varchar(160)", (column) =>
        column.notNull().references("guest_identities.id").onDelete("cascade"),
      )
      .addColumn("token_digest", "char(64)", (column) => column.notNull().unique())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("revoked_at", "timestamptz")
      .addCheckConstraint(
        "guest_sessions_fixed_expiry_check",
        sql`expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours'`,
      )
      .execute();
    await database.schema
      .createIndex("guest_sessions_expiry_idx")
      .on("guest_sessions")
      .columns(["expires_at", "revoked_at"])
      .execute();
  },
  async down(database: Kysely<unknown>): Promise<void> {
    await database.schema.dropTable("guest_sessions").ifExists().execute();
  },
};
