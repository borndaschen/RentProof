import type { ActorContext } from "@/application/repositories";
import type {
  AvailableRealArtifact,
  RealArtifactKind,
  RealAnalysisSnapshot,
  RealArtifactReservation,
  StoredArtifactPaths,
} from "./contracts";

export interface RealDemoRepositoryPort {
  createCase(input: {
    actor: ActorContext;
    displayName: string;
    cloudProcessingConsentVersion: string;
    cloudProcessingConsentHash: string;
    now: Date;
  }): Promise<{ caseId: string }>;
  reserveArtifact(input: {
    actor: ActorContext;
    reservation: RealArtifactReservation;
    now: Date;
  }): Promise<void>;
  finalizeArtifact(input: {
    actor: ActorContext;
    reservation: RealArtifactReservation;
    stored: StoredArtifactPaths;
    now: Date;
  }): Promise<void>;
  abandonArtifact(input: {
    actor: ActorContext;
    reservation: RealArtifactReservation;
    now: Date;
  }): Promise<void>;
  deleteCase(input: { actor: ActorContext; caseId: string; now: Date }): Promise<boolean>;
  completeCaseDeletion(input: { actor: ActorContext; caseId: string; now: Date }): Promise<void>;
  transferGuestCase(input: {
    guest: ActorContext & { kind: "guest" };
    user: ActorContext & { kind: "user" };
    caseId: string;
    now: Date;
  }): Promise<"transferred" | "not_found_or_forbidden" | "already_transferred">;
  getConversationContext(input: { actor: ActorContext; caseId: string }): Promise<{
    revision: number;
    status: "draft" | "analyzing" | "needs_attention" | "ready";
    artifactKinds: readonly RealArtifactKind[];
    listingUrlAvailable: boolean;
  }>;
  saveListingUrlSource(input: {
    actor: ActorContext;
    caseId: string;
    expectedRevision: number;
    sourceUrl: string;
    text: string;
    contentHash: string;
    now: Date;
  }): Promise<"saved" | "stale" | "not_found_or_forbidden">;
  getListingUrlSource(input: {
    actor: ActorContext;
    caseId: string;
  }): Promise<{ sourceUrl: string; text: string; contentHash: string } | null>;
  listAvailableArtifacts(input: {
    actor: ActorContext;
    caseId: string;
  }): Promise<readonly AvailableRealArtifact[]>;
  commitAnalysis(input: {
    actor: ActorContext;
    caseId: string;
    snapshot: RealAnalysisSnapshot;
    now: Date;
  }): Promise<void>;
}

export interface EncryptedRealArtifactStorePort {
  save(input: {
    reservation: RealArtifactReservation;
    originalBytes: Uint8Array;
    derivative?: Readonly<{ bytes: Uint8Array; sha256: string }>;
    extractedText?: string;
  }): Promise<StoredArtifactPaths>;
  deleteArtifact(reservation: RealArtifactReservation): Promise<void>;
  deleteCase(caseId: string): Promise<void>;
  read(relativePath: string): Promise<Uint8Array>;
}
