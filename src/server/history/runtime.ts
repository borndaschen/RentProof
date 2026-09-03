import "server-only";
import {
  CaseHistoryService,
  type CaseHistoryDetail,
  type CaseHistorySummary,
} from "@/application/history";
import type { ActorContext } from "@/application/repositories";
import {
  PostgresCaseHistoryRepository,
  createPostgresRuntime,
  parsePostgresDatabaseConfig,
} from "@/adapters/database/postgres";
import { resolveCurrentAccountActor } from "@/server/auth/current-actor";
import { getServerEnvironment } from "@/server/env";

export type HistoryRuntimeErrorCode = "HISTORY_FEATURE_DISABLED" | "HISTORY_DATABASE_UNCONFIGURED";

export class HistoryRuntimeError extends Error {
  override readonly name = "HistoryRuntimeError";

  constructor(readonly code: HistoryRuntimeErrorCode) {
    super(code);
  }
}

export async function listCurrentActorHistory(
  request: Request,
): Promise<readonly CaseHistorySummary[]> {
  return withHistoryRuntime(request, async (history, actor) => history.list(actor));
}

export async function getCurrentActorCaseHistory(
  request: Request,
  caseId: string,
): Promise<CaseHistoryDetail> {
  return withHistoryRuntime(request, async (history, actor) => history.detail(actor, caseId));
}

async function withHistoryRuntime<T>(
  request: Request,
  operation: (
    history: CaseHistoryService,
    actor: (ActorContext & { kind: "user" }) | null,
  ) => Promise<T>,
): Promise<T> {
  const environment = getServerEnvironment();
  if (
    !["local_development", "lan_secure_demo"].includes(environment.RENTPROOF_DEPLOYMENT_PROFILE) ||
    environment.RENTPROOF_AUTH_MODE !== "self_hosted"
  ) {
    throw new HistoryRuntimeError("HISTORY_FEATURE_DISABLED");
  }
  if (process.env["RENTPROOF_DATABASE_ADAPTER"] !== "postgres") {
    throw new HistoryRuntimeError("HISTORY_DATABASE_UNCONFIGURED");
  }

  let config;
  try {
    config = parsePostgresDatabaseConfig(process.env);
  } catch {
    throw new HistoryRuntimeError("HISTORY_DATABASE_UNCONFIGURED");
  }
  if (config.role !== "app") throw new HistoryRuntimeError("HISTORY_DATABASE_UNCONFIGURED");

  let actor;
  try {
    actor = await resolveCurrentAccountActor(request, true);
  } catch {
    throw new HistoryRuntimeError("HISTORY_DATABASE_UNCONFIGURED");
  }
  const postgres = createPostgresRuntime(config);
  try {
    return await operation(
      new CaseHistoryService(new PostgresCaseHistoryRepository(postgres.database)),
      actor,
    );
  } finally {
    await postgres.close();
  }
}
