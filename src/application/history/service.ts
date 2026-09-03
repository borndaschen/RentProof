import type { ActorContext } from "@/application/repositories";
import { OpaqueIdSchema } from "@/domain/conversation";
import {
  CaseHistoryDetailSchema,
  CaseHistorySummarySchema,
  HistoryAccessError,
  type CaseHistoryDetail,
  type CaseHistorySummary,
} from "./contracts";
import type { CaseHistoryRepository } from "./ports";

export class CaseHistoryService {
  constructor(private readonly repository: CaseHistoryRepository) {}

  async list(actor: ActorContext | null): Promise<readonly CaseHistorySummary[]> {
    const user = requireAccountActor(actor);
    return (await this.repository.listOwned(user)).map((entry) =>
      CaseHistorySummarySchema.parse(entry),
    );
  }

  async detail(actor: ActorContext | null, caseId: string): Promise<CaseHistoryDetail> {
    const user = requireAccountActor(actor);
    const parsedCaseId = OpaqueIdSchema.safeParse(caseId);
    if (!parsedCaseId.success) {
      throw new HistoryAccessError("HISTORY_NOT_FOUND_OR_FORBIDDEN");
    }
    const detail = await this.repository.findOwned(user, parsedCaseId.data);
    if (!detail) throw new HistoryAccessError("HISTORY_NOT_FOUND_OR_FORBIDDEN");
    return CaseHistoryDetailSchema.parse(detail);
  }
}

function requireAccountActor(actor: ActorContext | null): ActorContext & { kind: "user" } {
  if (!actor) throw new HistoryAccessError("HISTORY_AUTHENTICATION_REQUIRED");
  if (actor.kind !== "user") throw new HistoryAccessError("HISTORY_ACCOUNT_REQUIRED");
  return actor;
}
