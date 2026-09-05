import { describe, expect, it } from "vitest";
import type { PostgresDatabaseConfig } from "./config";
import {
  assertPostgresDemoReadiness,
  PostgresReadinessError,
  type PostgresReadinessSnapshot,
} from "./readiness";

const migrationConfig: PostgresDatabaseConfig = {
  connectionString: "postgresql://rentproof_demo_migration:secret@127.0.0.1:5433/rentproof_demo",
  role: "migration",
  environment: "synthetic_demo",
  maxConnections: 1,
};
const base: PostgresReadinessSnapshot = {
  serverAddress: "127.0.0.1",
  databaseName: "rentproof_demo",
  roleName: "rentproof_demo_migration",
  searchPath: "rentproof, pg_catalog",
  isSuperuser: false,
  canCreateDatabase: false,
  canCreateRole: false,
  canBypassRowSecurity: false,
  hasSchemaUsage: true,
  hasSchemaCreate: true,
  productTableCount: 0,
  hasMigrationTable: false,
  hasMigrationLockTable: false,
  canMutateMigrationTable: false,
};

describe("PostgreSQL Demo readiness", () => {
  it("accepts the least-privilege migration role before migration", () => {
    expect(() => assertPostgresDemoReadiness(migrationConfig, "migration", base)).not.toThrow();
  });

  it("accepts the app role only after schema and migration ACL finalization", () => {
    const config = {
      ...migrationConfig,
      connectionString: "postgresql://rentproof_demo_app:secret@127.0.0.1:5433/rentproof_demo",
      role: "app" as const,
    };
    expect(() =>
      assertPostgresDemoReadiness(config, "app", {
        ...base,
        roleName: "rentproof_demo_app",
        hasSchemaCreate: false,
        productTableCount: 17,
        hasMigrationTable: true,
        hasMigrationLockTable: true,
      }),
    ).not.toThrow();
  });

  it.each([
    ["superuser", { isSuperuser: true }, "POSTGRES_READINESS_PRIVILEGE_INVALID"],
    ["remote", { serverAddress: "192.168.1.20" }, "POSTGRES_READINESS_REMOTE_SERVER"],
    ["CIDR text", { serverAddress: "127.0.0.1/32" }, "POSTGRES_READINESS_REMOTE_SERVER"],
    ["mapped IPv4", { serverAddress: "::ffff:127.0.0.1" }, "POSTGRES_READINESS_REMOTE_SERVER"],
    ["public path", { searchPath: "public" }, "POSTGRES_READINESS_SEARCH_PATH_INVALID"],
    ["wrong role", { roleName: "postgres" }, "POSTGRES_READINESS_WRONG_ROLE"],
    ["wrong database", { databaseName: "postgres" }, "POSTGRES_READINESS_WRONG_DATABASE"],
  ] as const)("rejects %s", (_name, overrides, code) => {
    expect(() =>
      assertPostgresDemoReadiness(migrationConfig, "migration", { ...base, ...overrides }),
    ).toThrowError(new PostgresReadinessError(code));
  });

  it("rejects an app role with incomplete tables or migration-table write access", () => {
    const config = {
      ...migrationConfig,
      connectionString: "postgresql://rentproof_demo_app:secret@127.0.0.1:5433/rentproof_demo",
      role: "app" as const,
    };
    expect(() =>
      assertPostgresDemoReadiness(config, "app", {
        ...base,
        roleName: "rentproof_demo_app",
        hasSchemaCreate: false,
        productTableCount: 13,
        hasMigrationTable: true,
        hasMigrationLockTable: true,
        canMutateMigrationTable: true,
      }),
    ).toThrowError(new PostgresReadinessError("POSTGRES_READINESS_SCHEMA_INCOMPLETE"));
  });

  it("rejects an app role when the migration lock table is missing", () => {
    const config = {
      ...migrationConfig,
      connectionString: "postgresql://rentproof_demo_app:secret@127.0.0.1:5433/rentproof_demo",
      role: "app" as const,
    };
    expect(() =>
      assertPostgresDemoReadiness(config, "app", {
        ...base,
        roleName: "rentproof_demo_app",
        hasSchemaCreate: false,
        productTableCount: 13,
        hasMigrationTable: true,
        hasMigrationLockTable: false,
      }),
    ).toThrowError(new PostgresReadinessError("POSTGRES_READINESS_SCHEMA_INCOMPLETE"));
  });
});
