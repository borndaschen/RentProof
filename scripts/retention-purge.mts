import { RetentionPurgeService } from "../src/application/retention/service.ts";
import {
  PostgresRetentionRepository,
  createPostgresRuntime,
  parsePostgresDatabaseConfig,
} from "../src/adapters/database/postgres/index.ts";
import {
  EncryptedRealArtifactStore,
  parseRealDataEncryptionKey,
} from "../src/adapters/storage/encrypted-real-artifacts.ts";

if (!process.argv.slice(2).includes("--run") || process.env["RENTPROOF_RETENTION_PURGE"] !== "1") {
  console.error("RETENTION_PURGE_EXPLICIT_OPT_IN_REQUIRED");
  process.exitCode = 2;
} else {
  const runtime = createPostgresRuntime(parseRetentionDatabaseConfig());
  try {
    const root = process.env["RENTPROOF_REAL_DATA_DIR"];
    if (!root) throw new Error("RETENTION_STORAGE_ROOT_MISSING");
    const store = await EncryptedRealArtifactStore.create(
      root,
      parseRealDataEncryptionKey(process.env["RENTPROOF_DATA_ENCRYPTION_KEY"]),
    );
    const service = new RetentionPurgeService(
      new PostgresRetentionRepository(runtime.database),
      store,
    );
    const summary = await service.run(
      parseBatchSize(process.env["RENTPROOF_RETENTION_BATCH_SIZE"]),
    );
    console.log(`RETENTION_PURGE_COMPLETED ${JSON.stringify(summary)}`);
    if (summary.failed > 0) process.exitCode = 1;
  } catch {
    console.error("RETENTION_PURGE_FAILED");
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}

function parseRetentionDatabaseConfig() {
  const configuration = parsePostgresDatabaseConfig(process.env);
  if (configuration.environment !== "secure_demo" || configuration.role !== "app") {
    throw new Error("RETENTION_DATABASE_CONFIGURATION_INVALID");
  }
  return configuration;
}

function parseBatchSize(value: string | undefined): number {
  if (value === undefined) return 25;
  if (!/^\d+$/u.test(value)) throw new Error("RETENTION_BATCH_SIZE_INVALID");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("RETENTION_BATCH_SIZE_INVALID");
  }
  return parsed;
}
