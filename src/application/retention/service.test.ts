import { describe, expect, it, vi } from "vitest";
import type { RetentionArtifactStorePort, RetentionRepositoryPort } from "./ports";
import { RetentionPurgeService } from "./service";

function dependencies() {
  const repository: RetentionRepositoryPort = {
    claimNext: vi
      .fn()
      .mockResolvedValueOnce({
        claimId: "guest:guest_a",
        kind: "guest",
        targetId: "guest_a",
        caseIds: ["case_a", "case_b"],
      })
      .mockResolvedValueOnce(null),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    purgeExpiredMetadata: vi.fn(async () => ({
      deletionTombstones: 2,
      securityAuditEvents: 3,
    })),
  };
  const store: RetentionArtifactStorePort = { deleteCase: vi.fn(async () => undefined) };
  return { repository, store };
}

describe("RetentionPurgeService", () => {
  it("removes private files before atomically completing database purge", async () => {
    const { repository, store } = dependencies();
    await expect(new RetentionPurgeService(repository, store).run()).resolves.toEqual({
      completed: 1,
      failed: 0,
      caseFilesRemoved: 2,
      deletionTombstonesRemoved: 2,
      securityAuditEventsRemoved: 3,
      rawConversationRowsRemoved: 0,
    });
    expect(store.deleteCase).toHaveBeenNthCalledWith(1, "case_a");
    expect(store.deleteCase).toHaveBeenNthCalledWith(2, "case_b");
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it("keeps a failed target retryable and continues metadata retention", async () => {
    const { repository, store } = dependencies();
    vi.mocked(store.deleteCase).mockRejectedValueOnce(new Error("storage unavailable"));
    const result = await new RetentionPurgeService(repository, store).run(1);
    expect(result).toMatchObject({ completed: 0, failed: 1 });
    expect(repository.fail).toHaveBeenCalledOnce();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.purgeExpiredMetadata).toHaveBeenCalledOnce();
  });

  it("rejects unbounded batches", async () => {
    const { repository, store } = dependencies();
    await expect(new RetentionPurgeService(repository, store).run(101)).rejects.toThrow(
      "RETENTION_BATCH_LIMIT_INVALID",
    );
  });
});
