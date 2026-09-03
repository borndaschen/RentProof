import { createHash, randomBytes } from "node:crypto";
import type { ActorContext } from "@/application/repositories";
import { OpaqueIdSchema } from "@/domain/conversation";
import {
  RealArtifactReservationSchema,
  RealArtifactKindSchema,
  RealArtifactMimeSchema,
  RealAnalysisSnapshotSchema,
  RealCaseDisplayNameSchema,
  RealDemoAccessError,
  REAL_DEMO_CLOUD_CONSENT_TEXT,
  REAL_DEMO_CLOUD_CONSENT_VERSION,
  Sha256Schema,
  StoredArtifactPathsSchema,
  type RealArtifactKind,
  type RealArtifactAnalysisPayload,
  type RealArtifactMime,
} from "./contracts";
import type { EncryptedRealArtifactStorePort, RealDemoRepositoryPort } from "./ports";

export class RealDemoService {
  constructor(
    private readonly repository: RealDemoRepositoryPort,
    private readonly store: EncryptedRealArtifactStorePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCase(
    actor: (ActorContext & { kind: "user" }) | null,
    input: unknown,
  ): Promise<{ caseId: string }> {
    if (!actor) throw new RealDemoAccessError("REAL_DEMO_AUTH_REQUIRED");
    const parsed = RealCaseDisplayNameSchema.safeParse(
      typeof input === "object" && input !== null ? Reflect.get(input, "displayName") : undefined,
    );
    const acknowledged =
      typeof input === "object" &&
      input !== null &&
      Reflect.get(input, "cloudProcessingAcknowledged") === true;
    if (!parsed.success || !acknowledged) {
      throw new RealDemoAccessError("REAL_DEMO_REQUEST_INVALID");
    }
    return this.repository.createCase({
      actor,
      displayName: parsed.data,
      cloudProcessingConsentVersion: REAL_DEMO_CLOUD_CONSENT_VERSION,
      cloudProcessingConsentHash: createHash("sha256")
        .update(REAL_DEMO_CLOUD_CONSENT_TEXT, "utf8")
        .digest("hex"),
      now: this.now(),
    });
  }

  async saveArtifact(input: {
    actor: (ActorContext & { kind: "user" }) | null;
    caseId: unknown;
    kind: RealArtifactKind;
    mime: RealArtifactMime;
    originalSha256: string;
    originalBytes: Uint8Array;
    derivative?: Readonly<{ bytes: Uint8Array; sha256: string }>;
    extractedText?: string;
  }): Promise<{ artifactId: string }> {
    if (!input.actor) throw new RealDemoAccessError("REAL_DEMO_AUTH_REQUIRED");
    const caseId = OpaqueIdSchema.safeParse(input.caseId);
    const kind = RealArtifactKindSchema.safeParse(input.kind);
    const mime = RealArtifactMimeSchema.safeParse(input.mime);
    const originalSha256 = Sha256Schema.safeParse(input.originalSha256);
    const derivativeSha256 = input.derivative
      ? Sha256Schema.safeParse(input.derivative.sha256)
      : null;
    const isContract = input.kind === "contract_pdf";
    const shapeIsValid = isContract
      ? input.mime === "application/pdf" &&
        input.extractedText !== undefined &&
        input.derivative === undefined &&
        [...input.extractedText].length <= 300_000
      : input.mime !== "application/pdf" &&
        input.derivative !== undefined &&
        input.extractedText === undefined;
    if (
      !caseId.success ||
      !kind.success ||
      !mime.success ||
      !originalSha256.success ||
      input.originalBytes.byteLength === 0 ||
      input.originalBytes.byteLength > 25 * 1024 * 1024 ||
      (isContract && input.originalBytes.byteLength > 15 * 1024 * 1024) ||
      !shapeIsValid ||
      (input.derivative !== undefined &&
        (input.derivative.bytes.byteLength === 0 ||
          input.derivative.bytes.byteLength > 25 * 1024 * 1024 ||
          !derivativeSha256?.success)) ||
      createHash("sha256").update(input.originalBytes).digest("hex") !== originalSha256.data ||
      (input.derivative !== undefined &&
        createHash("sha256").update(input.derivative.bytes).digest("hex") !==
          derivativeSha256?.data)
    ) {
      throw new RealDemoAccessError("REAL_DEMO_REQUEST_INVALID");
    }
    const reservation = RealArtifactReservationSchema.parse({
      artifactId: `artifact_${randomBytes(24).toString("hex")}`,
      caseId: caseId.data,
      kind: kind.data,
      mime: mime.data,
      originalSha256: originalSha256.data,
      originalBytes: input.originalBytes.byteLength,
    });
    await this.repository.reserveArtifact({ actor: input.actor, reservation, now: this.now() });
    let stored;
    try {
      stored = StoredArtifactPathsSchema.parse(
        await this.store.save({
          reservation,
          originalBytes: input.originalBytes,
          ...(input.derivative ? { derivative: input.derivative } : {}),
          ...(input.extractedText === undefined ? {} : { extractedText: input.extractedText }),
        }),
      );
      await this.repository.finalizeArtifact({
        actor: input.actor,
        reservation,
        stored,
        now: this.now(),
      });
      return { artifactId: reservation.artifactId };
    } catch {
      await this.store.deleteArtifact(reservation).catch(() => undefined);
      await this.repository
        .abandonArtifact({ actor: input.actor, reservation, now: this.now() })
        .catch(() => undefined);
      throw new RealDemoAccessError("REAL_DEMO_STORAGE_FAILED");
    }
  }

  async deleteCase(
    actor: (ActorContext & { kind: "user" }) | null,
    caseId: unknown,
  ): Promise<void> {
    if (!actor) throw new RealDemoAccessError("REAL_DEMO_AUTH_REQUIRED");
    const parsed = OpaqueIdSchema.safeParse(caseId);
    if (!parsed.success) throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
    const deleted = await this.repository.deleteCase({
      actor,
      caseId: parsed.data,
      now: this.now(),
    });
    if (!deleted) throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
    try {
      await this.store.deleteCase(parsed.data);
      await this.repository.completeCaseDeletion({
        actor,
        caseId: parsed.data,
        now: this.now(),
      });
    } catch {
      throw new RealDemoAccessError("REAL_DEMO_STORAGE_FAILED");
    }
  }

  async loadAnalysisPayloads(
    actor: (ActorContext & { kind: "user" }) | null,
    caseId: unknown,
  ): Promise<readonly RealArtifactAnalysisPayload[]> {
    if (!actor) throw new RealDemoAccessError("REAL_DEMO_AUTH_REQUIRED");
    const parsed = OpaqueIdSchema.safeParse(caseId);
    if (!parsed.success) throw new RealDemoAccessError("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN");
    const artifacts = await this.repository.listAvailableArtifacts({ actor, caseId: parsed.data });
    const listingCount = artifacts.filter((item) => item.kind === "listing_image").length;
    const viewingCount = artifacts.filter(
      (item) => item.kind === "viewing_image" || item.kind === "follow_up_image",
    ).length;
    const contractCount = artifacts.filter((item) => item.kind === "contract_pdf").length;
    if (listingCount !== 1 || viewingCount < 1 || viewingCount > 12 || contractCount !== 1) {
      throw new RealDemoAccessError("REAL_DEMO_ARTIFACT_SET_INCOMPLETE");
    }
    const selections = artifacts.map((artifact) => {
      if (artifact.caseId !== parsed.data) {
        throw new RealDemoAccessError("REAL_DEMO_STORAGE_FAILED");
      }
      const selectedPath =
        artifact.kind === "contract_pdf"
          ? artifact.extractedTextRelativePath
          : artifact.derivativeRelativePath;
      const expectedPath = `${parsed.data}/${artifact.artifactId}/${
        artifact.kind === "contract_pdf" ? "extracted-text.enc" : "derivative.enc"
      }`;
      if (selectedPath !== expectedPath) {
        throw new RealDemoAccessError("REAL_DEMO_STORAGE_FAILED");
      }
      return { artifact, selectedPath };
    });
    const payloads = await Promise.all(
      selections.map(async ({ artifact, selectedPath }) => {
        let bytes: Uint8Array;
        try {
          bytes = await this.store.read(selectedPath);
        } catch {
          throw new RealDemoAccessError("REAL_DEMO_STORAGE_FAILED");
        }
        return {
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          mime: artifact.mime,
          bytes,
        };
      }),
    );
    return payloads;
  }

  async commitAnalysis(
    actor: (ActorContext & { kind: "user" }) | null,
    caseId: unknown,
    snapshot: unknown,
  ): Promise<void> {
    if (!actor) throw new RealDemoAccessError("REAL_DEMO_AUTH_REQUIRED");
    const parsedCaseId = OpaqueIdSchema.safeParse(caseId);
    const parsedSnapshot = RealAnalysisSnapshotSchema.safeParse(snapshot);
    if (
      !parsedCaseId.success ||
      !parsedSnapshot.success ||
      parsedSnapshot.data.caseId !== parsedCaseId.data
    ) {
      throw new RealDemoAccessError("REAL_DEMO_REQUEST_INVALID");
    }
    await this.repository.commitAnalysis({
      actor,
      caseId: parsedCaseId.data,
      snapshot: parsedSnapshot.data,
      now: this.now(),
    });
  }
}
