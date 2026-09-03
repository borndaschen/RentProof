import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Frozen, forward-only migration. Do not import current Domain/Application code.
export const privateCaseArtifactsMigration: Migration = {
  async up(database: Kysely<unknown>): Promise<void> {
    await database.schema
      .createTable("case_artifacts")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("case_id", "varchar(160)", (column) =>
        column.notNull().references("rental_cases.id"),
      )
      .addColumn("owner_type", "varchar(8)", (column) => column.notNull())
      .addColumn("owner_subject_id", "varchar(160)", (column) => column.notNull())
      .addColumn("artifact_kind", "varchar(32)", (column) => column.notNull())
      .addColumn("state", "varchar(24)", (column) => column.notNull())
      .addColumn("mime", "varchar(32)", (column) => column.notNull())
      .addColumn("original_sha256", "varchar(64)", (column) => column.notNull())
      .addColumn("derivative_sha256", "varchar(64)")
      .addColumn("original_bytes", "integer", (column) => column.notNull())
      .addColumn("derivative_bytes", "integer")
      .addColumn("original_relative_path", "varchar(500)", (column) => column.notNull())
      .addColumn("derivative_relative_path", "varchar(500)")
      .addColumn("extracted_text_relative_path", "varchar(500)")
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addColumn("updated_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addColumn("deleted_at", "timestamptz")
      .addCheckConstraint("case_artifacts_owner_type_check", sql`owner_type IN ('user', 'guest')`)
      .addCheckConstraint(
        "case_artifacts_kind_check",
        sql`artifact_kind IN ('listing_image', 'viewing_image', 'contract_pdf', 'follow_up_image')`,
      )
      .addCheckConstraint(
        "case_artifacts_state_check",
        sql`state IN ('quarantined', 'available', 'deletion_pending', 'purged')`,
      )
      .addCheckConstraint(
        "case_artifacts_mime_check",
        sql`mime IN ('image/jpeg', 'image/png', 'application/pdf')`,
      )
      .addCheckConstraint("case_artifacts_original_bytes_check", sql`original_bytes > 0`)
      .addCheckConstraint(
        "case_artifacts_derivative_bytes_check",
        sql`derivative_bytes IS NULL OR derivative_bytes > 0`,
      )
      .addUniqueConstraint("case_artifacts_case_hash_unique", ["case_id", "original_sha256"])
      .execute();
    await database.schema
      .createIndex("case_artifacts_owner_case_idx")
      .on("case_artifacts")
      .columns(["owner_type", "owner_subject_id", "case_id", "created_at"])
      .execute();
    await database.schema
      .createIndex("case_artifacts_deletion_idx")
      .on("case_artifacts")
      .columns(["state", "deleted_at"])
      .execute();
  },

  async down(database: Kysely<unknown>): Promise<void> {
    await database.schema.dropTable("case_artifacts").ifExists().execute();
  },
};
