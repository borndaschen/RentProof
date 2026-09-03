import type {
  ClaimedRetentionTarget,
  RetentionArtifactStorePort,
  RetentionRepositoryPort,
} from "./ports";

export type RetentionPurgeSummary = Readonly<{
  completed: number;
  failed: number;
  caseFilesRemoved: number;
  deletionTombstonesRemoved: number;
  securityAuditEventsRemoved: number;
  rawConversationRowsRemoved: 0;
}>;

export class RetentionPurgeService {
  constructor(
    private readonly repository: RetentionRepositoryPort,
    private readonly store: RetentionArtifactStorePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(limit = 25): Promise<RetentionPurgeSummary> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("RETENTION_BATCH_LIMIT_INVALID");
    }
    let completed = 0;
    let failed = 0;
    let caseFilesRemoved = 0;
    const attemptedClaimIds: string[] = [];
    for (let index = 0; index < limit; index += 1) {
      const target = await this.repository.claimNext(this.now(), attemptedClaimIds);
      if (!target) break;
      attemptedClaimIds.push(target.claimId);
      try {
        await this.removeCaseFiles(target);
        caseFilesRemoved += target.caseIds.length;
        await this.repository.complete(target, this.now());
        completed += 1;
      } catch {
        failed += 1;
        await this.repository.fail(target, this.now()).catch(() => undefined);
      }
    }
    const metadata = await this.repository.purgeExpiredMetadata(this.now());
    return {
      completed,
      failed,
      caseFilesRemoved,
      deletionTombstonesRemoved: metadata.deletionTombstones,
      securityAuditEventsRemoved: metadata.securityAuditEvents,
      // Production conversation text persistence is not enabled yet. Typed case
      // state is not raw chat and must not be removed by this retention pass.
      rawConversationRowsRemoved: 0,
    };
  }

  private async removeCaseFiles(target: ClaimedRetentionTarget): Promise<void> {
    for (const caseId of target.caseIds) await this.store.deleteCase(caseId);
  }
}
