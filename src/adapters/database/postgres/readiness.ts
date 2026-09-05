import type { PostgresDatabaseConfig } from "./config.ts";

export type PostgresReadinessPhase = "migration" | "app";

export type PostgresReadinessSnapshot = {
  serverAddress: string | null;
  databaseName: string;
  roleName: string;
  searchPath: string;
  isSuperuser: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canBypassRowSecurity: boolean;
  hasSchemaUsage: boolean;
  hasSchemaCreate: boolean;
  productTableCount: number;
  hasMigrationTable: boolean;
  hasMigrationLockTable: boolean;
  canMutateMigrationTable: boolean;
};

export class PostgresReadinessError extends Error {
  override readonly name = "PostgresReadinessError";
  readonly code:
    | "POSTGRES_READINESS_WRONG_ROLE"
    | "POSTGRES_READINESS_WRONG_DATABASE"
    | "POSTGRES_READINESS_REMOTE_SERVER"
    | "POSTGRES_READINESS_PRIVILEGE_INVALID"
    | "POSTGRES_READINESS_SEARCH_PATH_INVALID"
    | "POSTGRES_READINESS_SCHEMA_INCOMPLETE";

  constructor(code: PostgresReadinessError["code"]) {
    super(code);
    this.code = code;
  }
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);
const EXPECTED_PRODUCT_TABLE_COUNT = 17;

export function assertPostgresDemoReadiness(
  config: PostgresDatabaseConfig,
  phase: PostgresReadinessPhase,
  snapshot: PostgresReadinessSnapshot,
): void {
  const expectedRole = decodeURIComponent(new URL(config.connectionString).username);
  const expectedDatabase = decodeURIComponent(new URL(config.connectionString).pathname.slice(1));
  if (config.role !== phase || snapshot.roleName !== expectedRole) {
    throw new PostgresReadinessError("POSTGRES_READINESS_WRONG_ROLE");
  }
  if (snapshot.databaseName !== expectedDatabase) {
    throw new PostgresReadinessError("POSTGRES_READINESS_WRONG_DATABASE");
  }
  if (snapshot.serverAddress === null || !LOOPBACK_ADDRESSES.has(snapshot.serverAddress)) {
    throw new PostgresReadinessError("POSTGRES_READINESS_REMOTE_SERVER");
  }
  if (
    snapshot.isSuperuser ||
    snapshot.canCreateDatabase ||
    snapshot.canCreateRole ||
    snapshot.canBypassRowSecurity ||
    !snapshot.hasSchemaUsage ||
    (phase === "migration" ? !snapshot.hasSchemaCreate : snapshot.hasSchemaCreate)
  ) {
    throw new PostgresReadinessError("POSTGRES_READINESS_PRIVILEGE_INVALID");
  }
  const firstSearchPathEntry = snapshot.searchPath.split(",", 1)[0]?.trim();
  if (firstSearchPathEntry !== "rentproof") {
    throw new PostgresReadinessError("POSTGRES_READINESS_SEARCH_PATH_INVALID");
  }
  if (
    phase === "app" &&
    (snapshot.productTableCount !== EXPECTED_PRODUCT_TABLE_COUNT ||
      !snapshot.hasMigrationTable ||
      !snapshot.hasMigrationLockTable ||
      snapshot.canMutateMigrationTable)
  ) {
    throw new PostgresReadinessError("POSTGRES_READINESS_SCHEMA_INCOMPLETE");
  }
}
