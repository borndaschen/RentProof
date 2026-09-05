import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Frozen migration: no imports of application or domain contracts.
export const artifactProcessingMigration: Migration = {
  async up(database: Kysely<unknown>): Promise<void> {
    await database.schema
      .createTable("artifact_processing")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("case_id", "varchar(160)", (column) =>
        column.notNull().references("rental_cases.id").onDelete("cascade"),
      )
      .addColumn("actor_ref", "varchar(160)", (column) => column.notNull())
      .addColumn("idempotency_hash", "varchar(64)", (column) => column.notNull().unique())
      .addColumn("record", "jsonb", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .execute();
    await database.schema
      .createIndex("artifact_processing_case_idx")
      .on("artifact_processing")
      .column("case_id")
      .execute();
    await database.schema
      .createTable("runtime_queue_state")
      .addColumn("id", "varchar(32)", (column) => column.primaryKey())
      .addColumn("payload", "text")
      .execute();
    await sql`INSERT INTO runtime_queue_state (id, payload) VALUES ('media', NULL)`.execute(
      database,
    );
    await database.schema
      .createTable("case_evidence_budgets")
      .addColumn("case_id", "varchar(160)", (column) =>
        column.primaryKey().references("rental_cases.id").onDelete("cascade"),
      )
      .addColumn("events", "jsonb", (column) => column.notNull())
      .execute();
  },
  async down(database: Kysely<unknown>): Promise<void> {
    await database.schema.dropTable("case_evidence_budgets").execute();
    await database.schema.dropTable("artifact_processing").execute();
    await database.schema.dropTable("runtime_queue_state").execute();
  },
};
