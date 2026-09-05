import "server-only";
import { RealDemoService } from "@/application/real-demo";
import {
  PostgresRealDemoRepository,
  createPostgresRuntime,
  parsePostgresDatabaseConfig,
  type PostgresRuntime,
} from "@/adapters/database/postgres";
import {
  EncryptedRealArtifactStore,
  parseRealDataEncryptionKey,
} from "@/adapters/storage/encrypted-real-artifacts";
import { getServerEnvironment } from "@/server/env";
import { composeArtifactProcessing } from "./processing";
import { PostgresEvidenceBudgetRepository } from "@/adapters/database/postgres/evidence-budget-repository";

export type RealDemoRuntime = Readonly<{
  service: RealDemoService;
  processing: ReturnType<typeof composeArtifactProcessing>;
  budget: PostgresEvidenceBudgetRepository;
}>;

let runtimePromise: Promise<RealDemoRuntime> | undefined;
let postgresRuntime: PostgresRuntime | undefined;

export function getRealDemoRuntime(): Promise<RealDemoRuntime> {
  runtimePromise ??= composeRuntime();
  return runtimePromise;
}

async function composeRuntime(): Promise<RealDemoRuntime> {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
    environment.RENTPROOF_ALLOW_REAL_DATA !== "true" ||
    environment.RENTPROOF_AUTH_MODE !== "self_hosted"
  ) {
    throw new Error("REAL_DEMO_FEATURE_DISABLED");
  }
  const config = parsePostgresDatabaseConfig(process.env);
  if (config.role !== "app" || config.environment !== "secure_demo") {
    throw new Error("REAL_DEMO_DATABASE_INVALID");
  }
  const root = process.env["RENTPROOF_REAL_DATA_DIR"];
  if (!root) throw new Error("REAL_DATA_STORAGE_ROOT_INVALID");
  const store = await EncryptedRealArtifactStore.create(
    root,
    parseRealDataEncryptionKey(process.env["RENTPROOF_DATA_ENCRYPTION_KEY"]),
  );
  postgresRuntime = createPostgresRuntime(config);
  const budget = new PostgresEvidenceBudgetRepository(postgresRuntime.database);
  const processing = composeArtifactProcessing(postgresRuntime.database, store, budget);
  return {
    service: new RealDemoService(
      new PostgresRealDemoRepository(postgresRuntime.database),
      store,
      () => new Date(),
      (caseId) => processing.queue.purgeDeletedCase(caseId),
    ),
    processing,
    budget,
  };
}

export async function closeRealDemoRuntimeForTests(): Promise<void> {
  if (runtimePromise) await (await runtimePromise).processing.stop();
  await postgresRuntime?.close();
  postgresRuntime = undefined;
  runtimePromise = undefined;
}
