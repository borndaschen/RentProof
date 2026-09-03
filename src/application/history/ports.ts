import type { ActorContext } from "@/application/repositories";
import type { CaseHistoryDetail, CaseHistorySummary } from "./contracts";

export interface CaseHistoryRepository {
  listOwned(actor: ActorContext): Promise<readonly CaseHistorySummary[]>;
  findOwned(actor: ActorContext, caseId: string): Promise<CaseHistoryDetail | null>;
}
