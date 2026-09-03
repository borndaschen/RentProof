export class InMemorySyntheticUploadCoordinator {
  readonly #activeCases = new Set<string>();
  readonly #completedIdempotencyKeys = new Set<string>();

  acquire(
    caseId: string,
    idempotencyKey: string,
  ): { ok: true } | { ok: false; code: "UPLOAD_REPLAYED" | "UPLOAD_CONCURRENT_REQUEST" } {
    if (this.#completedIdempotencyKeys.has(idempotencyKey)) {
      return { ok: false, code: "UPLOAD_REPLAYED" };
    }
    if (this.#activeCases.has(caseId)) {
      return { ok: false, code: "UPLOAD_CONCURRENT_REQUEST" };
    }
    this.#activeCases.add(caseId);
    return { ok: true };
  }

  complete(caseId: string, idempotencyKey: string): void {
    this.#activeCases.delete(caseId);
    this.#completedIdempotencyKeys.add(idempotencyKey);
  }

  release(caseId: string): void {
    this.#activeCases.delete(caseId);
  }
}
