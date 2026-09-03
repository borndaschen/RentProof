import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Frozen historical migration: clerk_user_id belongs to the abandoned provider schema.
// Do not change this file or import current Domain/Application types or constants here.
export const initialRealDataSchemaMigration: Migration = {
  async up(database: Kysely<unknown>): Promise<void> {
    await database.schema
      .createTable("internal_users")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("clerk_user_id", "varchar(160)", (column) => column.notNull().unique())
      .addColumn("email_verified", "boolean", (column) => column.notNull())
      .addColumn("status", "varchar(32)", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addColumn("updated_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addCheckConstraint(
        "internal_users_status_check",
        sql`status IN ('active', 'disabled', 'deletion_pending')`,
      )
      .execute();

    await database.schema
      .createTable("guest_identities")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addColumn("expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("purge_state", "varchar(16)", (column) => column.notNull())
      .addCheckConstraint(
        "guest_identities_purge_state_check",
        sql`purge_state IN ('active', 'pending', 'purged')`,
      )
      .execute();

    await database.schema
      .createTable("rental_cases")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("owner_type", "varchar(8)", (column) => column.notNull())
      .addColumn("owner_subject_id", "varchar(160)", (column) => column.notNull())
      .addColumn("display_name", "varchar(120)", (column) => column.notNull())
      .addColumn("status", "varchar(32)", (column) => column.notNull())
      .addColumn("revision", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("active_snapshot_id", "varchar(160)")
      .addColumn("state", "jsonb", (column) => column.notNull())
      .addColumn("source_mode", "varchar(8)", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addColumn("updated_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addColumn("deleted_at", "timestamptz")
      .addCheckConstraint("rental_cases_owner_type_check", sql`owner_type IN ('user', 'guest')`)
      .addCheckConstraint(
        "rental_cases_status_check",
        sql`status IN ('draft', 'analyzing', 'needs_attention', 'ready', 'deletion_pending')`,
      )
      .addCheckConstraint("rental_cases_revision_check", sql`revision >= 0`)
      .addCheckConstraint("rental_cases_source_mode_check", sql`source_mode IN ('live', 'fixture')`)
      .execute();
    await database.schema
      .createIndex("rental_cases_owner_updated_idx")
      .on("rental_cases")
      .columns(["owner_type", "owner_subject_id", "updated_at"])
      .execute();

    await database.schema
      .createTable("policy_documents")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("policy_type", "varchar(40)", (column) => column.notNull())
      .addColumn("version", "varchar(80)", (column) => column.notNull())
      .addColumn("locale", "varchar(12)", (column) => column.notNull())
      .addColumn("content_hash", "varchar(128)", (column) => column.notNull())
      .addColumn("canonical_url", "varchar(500)", (column) => column.notNull())
      .addColumn("status", "varchar(16)", (column) => column.notNull())
      .addColumn("published_at", "timestamptz")
      .addColumn("effective_at", "timestamptz")
      .addUniqueConstraint("policy_documents_version_unique", ["policy_type", "version", "locale"])
      .addCheckConstraint(
        "policy_documents_type_check",
        sql`policy_type IN ('terms', 'privacy_notice', 'cloud_processing_notice', 'cookie_policy')`,
      )
      .addCheckConstraint("policy_documents_locale_check", sql`locale = 'zh-TW'`)
      .addCheckConstraint(
        "policy_documents_status_check",
        sql`status IN ('draft', 'published', 'retired')`,
      )
      .execute();

    await database.schema
      .createTable("policy_events")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("actor_type", "varchar(8)", (column) => column.notNull())
      .addColumn("actor_subject_id", "varchar(160)", (column) => column.notNull())
      .addColumn("policy_document_id", "varchar(160)", (column) =>
        column.notNull().references("policy_documents.id"),
      )
      .addColumn("event_type", "varchar(20)", (column) => column.notNull())
      .addColumn("occurred_at", "timestamptz", (column) => column.notNull())
      .addColumn("source_route", "varchar(200)", (column) => column.notNull())
      .addColumn("case_id", "varchar(160)")
      .addColumn("analysis_run_id", "varchar(160)")
      .addColumn("processor_list_version", "varchar(80)")
      .addColumn("audit_ref", "varchar(160)", (column) => column.notNull())
      .addCheckConstraint("policy_events_actor_type_check", sql`actor_type IN ('user', 'guest')`)
      .addCheckConstraint(
        "policy_events_event_type_check",
        sql`event_type IN ('accepted', 'acknowledged', 'consented', 'declined', 'withdrawn')`,
      )
      .execute();
    await database.schema
      .createIndex("policy_events_actor_occurred_idx")
      .on("policy_events")
      .columns(["actor_type", "actor_subject_id", "occurred_at"])
      .execute();

    await database.schema
      .createTable("consent_preferences")
      .addColumn("actor_type", "varchar(8)", (column) => column.notNull())
      .addColumn("actor_subject_id", "varchar(160)", (column) => column.notNull())
      .addColumn("purpose_key", "varchar(20)", (column) => column.notNull())
      .addColumn("decision", "varchar(16)", (column) => column.notNull())
      .addColumn("cookie_policy_version", "varchar(80)", (column) => column.notNull())
      .addColumn("inventory_version", "varchar(80)", (column) => column.notNull())
      .addColumn("occurred_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("consent_preferences_primary", [
        "actor_type",
        "actor_subject_id",
        "purpose_key",
      ])
      .addCheckConstraint(
        "consent_preferences_purpose_check",
        sql`purpose_key IN ('functional', 'analytics', 'marketing')`,
      )
      .addCheckConstraint(
        "consent_preferences_decision_check",
        sql`decision IN ('granted', 'declined', 'withdrawn')`,
      )
      .execute();

    await database.schema
      .createTable("deletion_requests")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("target_type", "varchar(16)", (column) => column.notNull())
      .addColumn("target_id", "varchar(160)", (column) => column.notNull())
      .addColumn("requested_by_type", "varchar(8)", (column) => column.notNull())
      .addColumn("requested_by_subject_id", "varchar(160)", (column) => column.notNull())
      .addColumn("status", "varchar(16)", (column) => column.notNull())
      .addColumn("requested_at", "timestamptz", (column) => column.notNull())
      .addColumn("purge_deadline", "timestamptz", (column) => column.notNull())
      .addColumn("attempt_count", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("completed_at", "timestamptz")
      .addColumn("correlation_id", "varchar(160)", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .addUniqueConstraint("deletion_requests_active_target_unique", ["target_type", "target_id"])
      .addCheckConstraint("deletion_requests_target_check", sql`target_type IN ('case', 'account')`)
      .addCheckConstraint(
        "deletion_requests_actor_check",
        sql`requested_by_type IN ('user', 'guest')`,
      )
      .addCheckConstraint(
        "deletion_requests_status_check",
        sql`status IN ('pending', 'processing', 'completed', 'failed')`,
      )
      .addCheckConstraint("deletion_requests_attempt_check", sql`attempt_count >= 0`)
      .execute();

    await database.schema
      .createTable("security_audit_events")
      .addColumn("id", "varchar(160)", (column) => column.primaryKey())
      .addColumn("event_type", "varchar(80)", (column) => column.notNull())
      .addColumn("occurred_at", "timestamptz", (column) => column.notNull())
      .addColumn("outcome", "varchar(8)", (column) => column.notNull())
      .addColumn("reason_code", "varchar(80)", (column) => column.notNull())
      .addColumn("correlation_id", "varchar(160)", (column) => column.notNull())
      .addColumn("actor_ref", "varchar(160)")
      .addColumn("target_ref", "varchar(160)")
      .addColumn("provider_ref", "varchar(160)")
      .addCheckConstraint(
        "security_audit_events_outcome_check",
        sql`outcome IN ('success', 'failure')`,
      )
      .execute();
    await database.schema
      .createIndex("security_audit_events_retention_idx")
      .on("security_audit_events")
      .column("occurred_at")
      .execute();
  },

  async down(database: Kysely<unknown>): Promise<void> {
    await database.schema.dropTable("security_audit_events").ifExists().execute();
    await database.schema.dropTable("deletion_requests").ifExists().execute();
    await database.schema.dropTable("consent_preferences").ifExists().execute();
    await database.schema.dropTable("policy_events").ifExists().execute();
    await database.schema.dropTable("policy_documents").ifExists().execute();
    await database.schema.dropTable("rental_cases").ifExists().execute();
    await database.schema.dropTable("guest_identities").ifExists().execute();
    await database.schema.dropTable("internal_users").ifExists().execute();
  },
};
