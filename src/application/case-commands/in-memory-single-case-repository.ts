import { SingleCaseAggregateSchema } from "./contracts";
import type { SingleCaseAggregate } from "./contracts";
import type { SaveCaseResult, SingleCaseRepository } from "./ports";

export class InMemorySingleCaseRepository implements SingleCaseRepository {
  #aggregate: SingleCaseAggregate;
  #nextSaveResult: SaveCaseResult = "saved";

  constructor(initialAggregate: SingleCaseAggregate) {
    this.#aggregate = SingleCaseAggregateSchema.parse(initialAggregate);
  }

  load(caseId: string): Promise<SingleCaseAggregate | null> {
    return Promise.resolve(
      caseId === this.#aggregate.caseId ? structuredClone(this.#aggregate) : null,
    );
  }

  saveAtomic(aggregate: SingleCaseAggregate, expectedRevision: number): Promise<SaveCaseResult> {
    const configured = this.#nextSaveResult;
    this.#nextSaveResult = "saved";
    if (configured !== "saved") return Promise.resolve(configured);
    if (this.#aggregate.revision !== expectedRevision) {
      return Promise.resolve("revision_conflict");
    }
    this.#aggregate = SingleCaseAggregateSchema.parse(structuredClone(aggregate));
    return Promise.resolve("saved");
  }

  failNextSave(result: Exclude<SaveCaseResult, "saved">): void {
    this.#nextSaveResult = result;
  }
}
