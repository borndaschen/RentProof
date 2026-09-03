import { Kysely, PostgresDialect } from "kysely";
import type { Pool, QueryResult } from "pg";
import { describe, expect, it } from "vitest";
import { FrozenPostgresMigrationProvider } from "./migration-provider";

describe("FrozenPostgresMigrationProvider", () => {
  it("returns a deterministic, explicitly versioned migration map", async () => {
    const migrations = await new FrozenPostgresMigrationProvider().getMigrations();
    expect(Object.keys(migrations)).toEqual([
      "001_initial_real_data_schema",
      "002_self_hosted_auth",
      "003_private_case_artifacts",
    ]);
    expect(migrations["001_initial_real_data_schema"]).toMatchObject({
      up: expect.any(Function),
      down: expect.any(Function),
    });
    expect(migrations["002_self_hosted_auth"]).toMatchObject({
      up: expect.any(Function),
      down: expect.any(Function),
    });
    expect(migrations["003_private_case_artifacts"]).toMatchObject({
      up: expect.any(Function),
      down: expect.any(Function),
    });
  });

  it("creates and drops the frozen schema without importing live application models", async () => {
    const queries: string[] = [];
    const pool = {
      on() {
        return this;
      },
      async connect() {
        return {
          async query(text: string): Promise<QueryResult> {
            queries.push(text);
            return { command: "DDL", rowCount: 0, oid: 0, fields: [], rows: [] };
          },
          release(): void {},
        };
      },
      async end(): Promise<void> {},
    };
    const database = new Kysely<unknown>({
      dialect: new PostgresDialect({ pool: pool as unknown as Pool }),
    });
    const migrations = await new FrozenPostgresMigrationProvider().getMigrations();
    for (const migration of Object.values(migrations)) {
      if (!migration.down) throw new Error("TEST_DOWN_MIGRATION_MISSING");
      await migration.up(database);
    }
    expect(queries.join("\n")).toContain('create table "internal_users"');
    expect(queries.join("\n")).toContain('create table "rental_cases"');
    expect(queries.join("\n")).toContain('create table "policy_events"');
    expect(queries.join("\n")).toContain('create table "deletion_requests"');
    expect(queries.join("\n")).toContain('create table "security_audit_events"');
    expect(queries.join("\n")).toContain('create table "auth_credentials"');
    expect(queries.join("\n")).toContain('create table "auth_sessions"');
    expect(queries.join("\n")).toContain('create table "auth_password_reset_challenges"');
    expect(queries.join("\n")).toContain('create table "auth_email_verification_challenges"');
    expect(queries.join("\n")).toContain('create table "case_artifacts"');
    expect(queries.join("\n")).toContain("argon2id");
    for (const migration of Object.values(migrations).reverse()) {
      if (!migration.down) throw new Error("TEST_DOWN_MIGRATION_MISSING");
      await migration.down(database);
    }
    expect(queries.join("\n")).toContain('drop table if exists "auth_sessions"');
    expect(queries.join("\n")).toContain('drop table if exists "case_artifacts"');
    expect(queries.join("\n")).toContain("DELETE FROM internal_users WHERE clerk_user_id IS NULL");
    expect(queries.join("\n")).toContain('drop table if exists "internal_users"');
    await database.destroy();
  });
});
