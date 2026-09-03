import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Frozen compatibility migration: clerk_user_id is retained nullable only so databases created
// by migration 001 can transition to self-hosted auth. Active runtime code must never use it.
// Do not change migration behavior or import current Domain/Application types or constants here.
export const selfHostedAuthMigration: Migration = {
  async up(database: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE internal_users ALTER COLUMN clerk_user_id DROP NOT NULL`.execute(
      database,
    );

    await database.schema
      .createTable("auth_credentials")
      .addColumn("user_id", "varchar(160)", (column) =>
        column.primaryKey().references("internal_users.id").onDelete("cascade"),
      )
      .addColumn("email_normalized", "varchar(254)", (column) => column.notNull().unique())
      .addColumn("password_hash", "varchar(512)", (column) => column.notNull())
      .addColumn("password_updated_at", "timestamptz", (column) => column.notNull())
      .addColumn("email_verified_at", "timestamptz")
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addColumn("updated_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addCheckConstraint("auth_credentials_argon2id_check", sql`password_hash LIKE '$argon2id$%'`)
      .addCheckConstraint(
        "auth_credentials_email_canonical_check",
        sql`email_normalized = lower(btrim(email_normalized)) AND octet_length(email_normalized) <= 254`,
      )
      .execute();

    await database.schema
      .createTable("auth_sessions")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("user_id", "varchar(160)", (column) =>
        column.notNull().references("internal_users.id").onDelete("cascade"),
      )
      .addColumn("token_digest", "char(64)", (column) => column.notNull().unique())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("last_used_at", "timestamptz", (column) => column.notNull())
      .addColumn("idle_expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("reverified_until", "timestamptz")
      .addColumn("revoked_at", "timestamptz")
      .addColumn("version", "integer", (column) => column.notNull().defaultTo(0))
      .addCheckConstraint("auth_sessions_version_check", sql`version >= 0`)
      .addCheckConstraint(
        "auth_sessions_idle_window_check",
        sql`idle_expires_at > created_at AND idle_expires_at <= last_used_at + INTERVAL '7 days'`,
      )
      .execute();
    await database.schema
      .createIndex("auth_sessions_user_active_idx")
      .on("auth_sessions")
      .columns(["user_id", "idle_expires_at"])
      .execute();

    await database.schema
      .createTable("auth_password_reset_challenges")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("user_id", "varchar(160)", (column) =>
        column.notNull().references("internal_users.id").onDelete("cascade"),
      )
      .addColumn("token_digest", "char(64)", (column) => column.notNull().unique())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("attempt_count", "smallint", (column) => column.notNull().defaultTo(0))
      .addColumn("consumed_at", "timestamptz")
      .addCheckConstraint(
        "auth_password_reset_attempt_check",
        sql`attempt_count >= 0 AND attempt_count <= 5`,
      )
      .addCheckConstraint(
        "auth_password_reset_expiry_check",
        sql`expires_at > created_at AND expires_at <= created_at + INTERVAL '15 minutes'`,
      )
      .execute();
    await database.schema
      .createIndex("auth_password_reset_user_idx")
      .on("auth_password_reset_challenges")
      .columns(["user_id", "created_at"])
      .execute();

    await database.schema
      .createTable("auth_email_verification_challenges")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("user_id", "varchar(160)", (column) =>
        column.notNull().references("internal_users.id").onDelete("cascade"),
      )
      .addColumn("token_digest", "char(64)", (column) => column.notNull().unique())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("attempt_count", "smallint", (column) => column.notNull().defaultTo(0))
      .addColumn("consumed_at", "timestamptz")
      .addCheckConstraint(
        "auth_email_verification_attempt_check",
        sql`attempt_count >= 0 AND attempt_count <= 5`,
      )
      .addCheckConstraint(
        "auth_email_verification_expiry_check",
        sql`expires_at > created_at AND expires_at <= created_at + INTERVAL '15 minutes'`,
      )
      .execute();
    await database.schema
      .createIndex("auth_email_verification_user_idx")
      .on("auth_email_verification_challenges")
      .columns(["user_id", "created_at"])
      .execute();
  },

  async down(database: Kysely<unknown>): Promise<void> {
    await database.schema.dropTable("auth_email_verification_challenges").ifExists().execute();
    await database.schema.dropTable("auth_password_reset_challenges").ifExists().execute();
    await database.schema.dropTable("auth_sessions").ifExists().execute();
    await database.schema.dropTable("auth_credentials").ifExists().execute();
    // `down` is local/ephemeral-only. Remove identities that cannot exist in schema 001.
    await sql`DELETE FROM internal_users WHERE clerk_user_id IS NULL`.execute(database);
    await sql`ALTER TABLE internal_users ALTER COLUMN clerk_user_id SET NOT NULL`.execute(database);
  },
};
