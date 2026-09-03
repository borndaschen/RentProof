import { Kysely, PostgresDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { Pool } from "pg";
import type { RentProofDatabase } from "./database.ts";
import type { PostgresDatabaseConfig } from "./config.ts";
import { FrozenPostgresMigrationProvider } from "./migration-provider.ts";

export type PostgresRuntime = {
  database: Kysely<RentProofDatabase>;
  close(): Promise<void>;
};

export function createPostgresRuntime(config: PostgresDatabaseConfig): PostgresRuntime {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
    application_name: `rentproof_${config.role}`,
  });
  const database = new Kysely<RentProofDatabase>({ dialect: new PostgresDialect({ pool }) });
  return {
    database,
    async close(): Promise<void> {
      await database.destroy();
    },
  };
}

export function createPostgresMigrator(database: Kysely<RentProofDatabase>): Migrator {
  return new Migrator({
    db: database,
    provider: new FrozenPostgresMigrationProvider(),
  });
}
