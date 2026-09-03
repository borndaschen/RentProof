import type { ActorContext } from "./actor-context";

export type VersionedCaseState<TState> = {
  caseId: string;
  revision: number;
  state: TState;
};

export type CreateCaseStateResult =
  { status: "created"; revision: 0 } | { status: "case_id_unavailable" };

export type SaveCaseStateResult =
  | { status: "saved"; revision: number }
  | { status: "not_found_or_forbidden" }
  | { status: "revision_conflict" };

export interface CaseStateRepository<TState> {
  create(actor: ActorContext, caseId: string, state: TState): Promise<CreateCaseStateResult>;
  load(actor: ActorContext, caseId: string): Promise<VersionedCaseState<TState> | null>;
  saveAtomic(
    actor: ActorContext,
    caseId: string,
    expectedRevision: number,
    state: TState,
  ): Promise<SaveCaseStateResult>;
}

export interface JsonStateFilesystemPort {
  readText(storageKey: string): Promise<string | null>;
  writeTextIfUnchanged(
    storageKey: string,
    expectedText: string | null,
    nextText: string,
  ): Promise<boolean>;
}
