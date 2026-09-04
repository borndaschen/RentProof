import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Frozen, forward-only migration. Do not import current Domain/Application code.
export const viewingVideoArtifactsMigration: Migration = {
  async up(database: Kysely<unknown>): Promise<void> {
    await database.schema
      .alterTable("case_artifacts")
      .dropConstraint("case_artifacts_kind_check")
      .execute();
    await database.schema
      .alterTable("case_artifacts")
      .addCheckConstraint(
        "case_artifacts_kind_check",
        sql`artifact_kind IN ('listing_image', 'viewing_image', 'contract_pdf', 'follow_up_image', 'viewing_video')`,
      )
      .execute();
    await database.schema
      .alterTable("case_artifacts")
      .dropConstraint("case_artifacts_mime_check")
      .execute();
    await database.schema
      .alterTable("case_artifacts")
      .addCheckConstraint(
        "case_artifacts_mime_check",
        sql`mime IN ('image/jpeg', 'image/png', 'application/pdf', 'video/mp4')`,
      )
      .execute();
  },

  async down(database: Kysely<unknown>): Promise<void> {
    await database.schema
      .alterTable("case_artifacts")
      .dropConstraint("case_artifacts_kind_check")
      .execute();
    await database.schema
      .alterTable("case_artifacts")
      .addCheckConstraint(
        "case_artifacts_kind_check",
        sql`artifact_kind IN ('listing_image', 'viewing_image', 'contract_pdf', 'follow_up_image')`,
      )
      .execute();
    await database.schema
      .alterTable("case_artifacts")
      .dropConstraint("case_artifacts_mime_check")
      .execute();
    await database.schema
      .alterTable("case_artifacts")
      .addCheckConstraint(
        "case_artifacts_mime_check",
        sql`mime IN ('image/jpeg', 'image/png', 'application/pdf')`,
      )
      .execute();
  },
};
