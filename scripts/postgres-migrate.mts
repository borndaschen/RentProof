import { parsePostgresDatabaseConfig } from "../src/adapters/database/postgres/config.ts";
import {
  createPostgresMigrator,
  createPostgresRuntime,
} from "../src/adapters/database/postgres/runtime.ts";

const direction = process.argv[2];
if (direction !== "up" && direction !== "down") {
  throw new Error("Usage: pnpm db:migrate -- up|down");
}

const config = parsePostgresDatabaseConfig(process.env);
if (config.role !== "migration") {
  throw new Error("POSTGRES_MIGRATION_ROLE_REQUIRED");
}
if (direction === "down" && config.environment !== "local_test") {
  throw new Error("POSTGRES_DOWN_MIGRATION_FORBIDDEN");
}

const runtime = createPostgresRuntime(config);
try {
  const migrator = createPostgresMigrator(runtime.database);
  const result =
    direction === "up" ? await migrator.migrateToLatest() : await migrator.migrateDown();
  if (result.error) throw result.error;
  for (const migration of result.results ?? []) {
    process.stdout.write(`${migration.migrationName}: ${migration.status}\n`);
  }
} finally {
  await runtime.close();
}
