import { sql } from "kysely";
import {
  parsePostgresDatabaseConfig,
  PostgresConfigurationError,
} from "../src/adapters/database/postgres/config.ts";
import {
  assertPostgresDemoReadiness,
  PostgresReadinessError,
  type PostgresReadinessSnapshot,
} from "../src/adapters/database/postgres/readiness.ts";
import { createPostgresRuntime } from "../src/adapters/database/postgres/runtime.ts";

async function main(): Promise<void> {
  const phase = process.argv[2];
  if (phase !== "migration" && phase !== "app") {
    throw new Error("POSTGRES_READINESS_USAGE_INVALID");
  }
  const config = parsePostgresDatabaseConfig(process.env);
  if (config.environment === "production") {
    throw new Error("POSTGRES_DEMO_READINESS_PRODUCTION_FORBIDDEN");
  }
  const runtime = createPostgresRuntime(config);
  try {
    const result = await sql<PostgresReadinessSnapshot>`
      SELECT
        host(inet_server_addr()) AS "serverAddress",
        current_database() AS "databaseName",
        current_user AS "roleName",
        current_setting('search_path') AS "searchPath",
        role.rolsuper AS "isSuperuser",
        role.rolcreatedb AS "canCreateDatabase",
        role.rolcreaterole AS "canCreateRole",
        role.rolbypassrls AS "canBypassRowSecurity",
        has_schema_privilege(current_user, 'rentproof', 'USAGE') AS "hasSchemaUsage",
        has_schema_privilege(current_user, 'rentproof', 'CREATE') AS "hasSchemaCreate",
        (
          SELECT count(*)::integer
          FROM pg_catalog.pg_tables
          WHERE schemaname = 'rentproof'
            AND tablename IN (
              'internal_users',
              'guest_identities',
              'rental_cases',
              'policy_documents',
              'policy_events',
              'consent_preferences',
              'deletion_requests',
              'security_audit_events',
              'auth_credentials',
              'auth_sessions',
              'auth_password_reset_challenges',
              'auth_email_verification_challenges',
              'case_artifacts',
              'guest_sessions',
              'artifact_processing',
              'runtime_queue_state',
              'case_evidence_budgets'
            )
        ) AS "productTableCount",
        to_regclass('rentproof.kysely_migration') IS NOT NULL AS "hasMigrationTable",
        to_regclass('rentproof.kysely_migration_lock') IS NOT NULL AS "hasMigrationLockTable",
        CASE
          WHEN to_regclass('rentproof.kysely_migration') IS NULL
            OR to_regclass('rentproof.kysely_migration_lock') IS NULL
          THEN false
          ELSE
            has_table_privilege(current_user, 'rentproof.kysely_migration', 'SELECT')
            OR has_table_privilege(current_user, 'rentproof.kysely_migration', 'INSERT')
            OR has_table_privilege(current_user, 'rentproof.kysely_migration', 'UPDATE')
            OR has_table_privilege(current_user, 'rentproof.kysely_migration', 'DELETE')
            OR has_table_privilege(current_user, 'rentproof.kysely_migration_lock', 'SELECT')
            OR has_table_privilege(current_user, 'rentproof.kysely_migration_lock', 'INSERT')
            OR has_table_privilege(current_user, 'rentproof.kysely_migration_lock', 'UPDATE')
            OR has_table_privilege(current_user, 'rentproof.kysely_migration_lock', 'DELETE')
        END AS "canMutateMigrationTable"
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user
    `.execute(runtime.database);
    const snapshot = result.rows[0];
    if (snapshot === undefined) throw new Error("POSTGRES_READINESS_ROLE_NOT_FOUND");
    assertPostgresDemoReadiness(config, phase, snapshot);
    process.stdout.write(
      `POSTGRES_READINESS_OK phase=${phase} database=${snapshot.databaseName} address=${snapshot.serverAddress}\n`,
    );
  } finally {
    await runtime.close();
  }
}

try {
  await main();
} catch (error: unknown) {
  let reason = "POSTGRES_READINESS_FAILED";
  if (error instanceof PostgresConfigurationError || error instanceof PostgresReadinessError) {
    reason = error.code;
  } else if (error instanceof Error && error.message.startsWith("POSTGRES_")) {
    reason = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "28P01" || error.code === "28000")
  ) {
    reason = "POSTGRES_CREDENTIAL_REQUIRED";
  }
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}
