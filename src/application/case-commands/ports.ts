import type { SingleCaseAggregate } from "./contracts";

export type SaveCaseResult = "saved" | "revision_conflict" | "failed";

export interface SingleCaseRepository {
  load(caseId: string): Promise<SingleCaseAggregate | null>;
  saveAtomic(aggregate: SingleCaseAggregate, expectedRevision: number): Promise<SaveCaseResult>;
}
