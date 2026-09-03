import type { Migration, MigrationProvider } from "kysely/migration";
import { initialRealDataSchemaMigration } from "./migrations/001_initial_real_data_schema.ts";
import { selfHostedAuthMigration } from "./migrations/002_self_hosted_auth.ts";
import { privateCaseArtifactsMigration } from "./migrations/003_private_case_artifacts.ts";

export class FrozenPostgresMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_initial_real_data_schema": initialRealDataSchemaMigration,
      "002_self_hosted_auth": selfHostedAuthMigration,
      "003_private_case_artifacts": privateCaseArtifactsMigration,
    };
  }
}
