import type { ActorContext } from "@/application/repositories";
import type {
  AvailableRealArtifact,
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
