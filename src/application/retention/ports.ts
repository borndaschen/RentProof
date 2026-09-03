export type ClaimedRetentionTarget = Readonly<{
  claimId: string;
  kind: "guest" | "case" | "account";
  targetId: string;
  caseIds: readonly string[];
}>;

export interface RetentionRepositoryPort {
  claimNext(now: Date, excludedClaimIds: readonly string[]): Promise<ClaimedRetentionTarget | null>;
  complete(target: ClaimedRetentionTarget, now: Date): Promise<void>;
  fail(target: ClaimedRetentionTarget, now: Date): Promise<void>;
  purgeExpiredMetadata(now: Date): Promise<{
    deletionTombstones: number;
    securityAuditEvents: number;
  }>;
}

export interface RetentionArtifactStorePort {
  deleteCase(caseId: string): Promise<void>;
}
