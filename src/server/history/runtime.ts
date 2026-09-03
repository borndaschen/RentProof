import "server-only";
import { cookies } from "next/headers";
import {
  CaseHistoryService,
  type CaseHistoryDetail,
  type CaseHistorySummary,
} from "@/application/history";
import {
  PostgresCaseHistoryRepository,
  createPostgresRuntime,
  parsePostgresDatabaseConfig,
} from "@/adapters/database/postgres";
import { readSessionCookie, setSessionCookie } from "@/server/auth/http";
import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
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
    actor: Awaited<ReturnType<typeof resolveEligibleActor>>,
  ) => Promise<T>,
): Promise<T> {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "local_development" ||
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

  const actor = await resolveEligibleActor(request);
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

async function resolveEligibleActor(request: Request) {
  const environment = getServerEnvironment();
  let resolution;
  try {
    resolution = await (
      await getSelfHostedAuthRuntime()
    ).service.resolveSession(readSessionCookie(request, environment), true);
  } catch {
    throw new HistoryRuntimeError("HISTORY_DATABASE_UNCONFIGURED");
  }
  if (resolution.status === "signed_out") return null;
  if (!resolution.refreshCookie) throw new HistoryRuntimeError("HISTORY_DATABASE_UNCONFIGURED");
  setSessionCookie(await cookies(), environment, resolution.refreshCookie);
  return resolution.actor;
}
