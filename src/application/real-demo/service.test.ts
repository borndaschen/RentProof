import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/application/repositories";
import type { EncryptedRealArtifactStorePort, RealDemoRepositoryPort } from "./ports";
import { RealDemoService } from "./service";

const actor = {
  kind: "user",
  userId: "user_abcdefghijklmnopqrstuvwxyz123456",
  sessionId: "session_abcdefghijklmnopqrstuvwxyz123",
} as const satisfies ActorContext;
const guestActor = {
  kind: "guest",
  guestId: "guest_abcdefghijklmnopqrstuvwxyz12345",
  guestSessionId: "guest_session_abcdefghijklmnopqrstuv",
} as const satisfies ActorContext;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function dependencies() {
  const repository: RealDemoRepositoryPort = {
    createCase: vi.fn(async () => ({ caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" })),
    reserveArtifact: vi.fn(async () => undefined),
    finalizeArtifact: vi.fn(async () => undefined),
    abandonArtifact: vi.fn(async () => undefined),
    deleteCase: vi.fn(async () => true),
    completeCaseDeletion: vi.fn(async () => undefined),
    listAvailableArtifacts: vi.fn(async () => []),
    commitAnalysis: vi.fn(async () => undefined),
  };
  const store: EncryptedRealArtifactStorePort = {
    save: vi.fn(async ({ reservation }) => ({
      originalRelativePath: `${reservation.caseId}/${reservation.artifactId}/original.enc`,
      derivativeRelativePath: null,
      extractedTextRelativePath: null,
      derivativeSha256: null,
      derivativeBytes: null,
    })),
    deleteArtifact: vi.fn(async () => undefined),
    deleteCase: vi.fn(async () => undefined),
    read: vi.fn(async () => Uint8Array.of(1)),
  };
  return { repository, store };
}

describe("RealDemoService", () => {
  it("requires a current actor and explicit cloud-processing acknowledgement", async () => {
    const { repository, store } = dependencies();
    const service = new RealDemoService(repository, store);
    await expect(
      service.createCase(null, { displayName: "測試套房", cloudProcessingAcknowledged: true }),
    ).rejects.toThrow("REAL_DEMO_AUTH_REQUIRED");
    await expect(
      service.createCase(actor, {
        displayName: "測試套房",
        cloudProcessingAcknowledged: false,
      }),
    ).rejects.toThrow("REAL_DEMO_REQUEST_INVALID");
  });

  it("allows a guest actor to create a case without an account", async () => {
    const { repository, store } = dependencies();
    const service = new RealDemoService(repository, store);

    await expect(
      service.createCase(guestActor, {
        displayName: "訪客案件",
        cloudProcessingAcknowledged: true,
      }),
    ).resolves.toMatchObject({ caseId: expect.stringMatching(/^case_/u) });
    expect(repository.createCase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: guestActor, displayName: "訪客案件" }),
    );
  });

  it("creates an owned case with versioned processing consent", async () => {
    const { repository, store } = dependencies();
    const now = new Date("2026-09-03T00:00:00.000Z");
    const service = new RealDemoService(repository, store, () => now);
    await expect(
      service.createCase(actor, {
        displayName: "  民生東路套房  ",
        cloudProcessingAcknowledged: true,
      }),
    ).resolves.toMatchObject({ caseId: expect.stringMatching(/^case_/u) });
    expect(repository.createCase).toHaveBeenCalledWith({
      actor,
      displayName: "民生東路套房",
      cloudProcessingConsentVersion: "rentproof.cloud-processing-demo.v1",
      cloudProcessingConsentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      now,
    });
  });

  it("reserves, encrypts and finalizes an artifact", async () => {
    const { repository, store } = dependencies();
    const service = new RealDemoService(repository, store);
    const originalBytes = Uint8Array.of(1, 2, 3);
    const result = await service.saveArtifact({
      actor,
      caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
      kind: "contract_pdf",
      mime: "application/pdf",
      originalSha256: sha256(originalBytes),
      originalBytes,
      extractedText: "contract",
    });
    expect(result.artifactId).toMatch(/^artifact_[a-f0-9]{48}$/u);
    expect(repository.reserveArtifact).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledOnce();
    expect(repository.finalizeArtifact).toHaveBeenCalledOnce();
  });

  it("fails closed and abandons the reservation when storage fails", async () => {
    const { repository, store } = dependencies();
    vi.mocked(store.save).mockRejectedValueOnce(new Error("disk failure"));
    const service = new RealDemoService(repository, store);
    const originalBytes = Uint8Array.of(1);
    const derivativeBytes = Uint8Array.of(2);
    await expect(
      service.saveArtifact({
        actor,
        caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
        kind: "listing_image",
        mime: "image/png",
        originalSha256: sha256(originalBytes),
        originalBytes,
        derivative: { bytes: derivativeBytes, sha256: sha256(derivativeBytes) },
      }),
    ).rejects.toThrow("REAL_DEMO_STORAGE_FAILED");
    expect(store.deleteArtifact).toHaveBeenCalledOnce();
    expect(repository.abandonArtifact).toHaveBeenCalledOnce();
    expect(repository.finalizeArtifact).not.toHaveBeenCalled();
  });

  it("rejects mismatched hashes and artifact shapes before reserving storage", async () => {
    const { repository, store } = dependencies();
    const service = new RealDemoService(repository, store);
    await expect(
      service.saveArtifact({
        actor,
        caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
        kind: "contract_pdf",
        mime: "application/pdf",
        originalSha256: "a".repeat(64),
        originalBytes: Uint8Array.of(1),
        derivative: { bytes: Uint8Array.of(2), sha256: "b".repeat(64) },
      }),
    ).rejects.toThrow("REAL_DEMO_REQUEST_INVALID");
    expect(repository.reserveArtifact).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("denies access immediately before removing stored case data", async () => {
    const { repository, store } = dependencies();
    const service = new RealDemoService(repository, store);
    await service.deleteCase(actor, "case_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(repository.deleteCase).toHaveBeenCalledOnce();
    expect(store.deleteCase).toHaveBeenCalledWith("case_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(repository.completeCaseDeletion).toHaveBeenCalledOnce();
  });

  it("keeps deletion pending when private storage removal fails", async () => {
    const { repository, store } = dependencies();
    vi.mocked(store.deleteCase).mockRejectedValueOnce(new Error("disk failure"));
    const service = new RealDemoService(repository, store);
    await expect(
      service.deleteCase(actor, "case_abcdefghijklmnopqrstuvwxyz1234567890"),
    ).rejects.toThrow("REAL_DEMO_STORAGE_FAILED");
    expect(repository.deleteCase).toHaveBeenCalledOnce();
    expect(repository.completeCaseDeletion).not.toHaveBeenCalled();
  });

  it("loads only the sanitized image derivatives and extracted contract text", async () => {
    const { repository, store } = dependencies();
    vi.mocked(repository.listAvailableArtifacts).mockResolvedValueOnce([
      {
        artifactId: "artifact_listing_abcdefghijklmnop",
        caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
        kind: "listing_image",
        mime: "image/png",
        derivativeRelativePath:
          "case_abcdefghijklmnopqrstuvwxyz1234567890/artifact_listing_abcdefghijklmnop/derivative.enc",
        extractedTextRelativePath: null,
      },
      {
        artifactId: "artifact_viewing_abcdefghijklmnop",
        caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
        kind: "viewing_image",
        mime: "image/jpeg",
        derivativeRelativePath:
          "case_abcdefghijklmnopqrstuvwxyz1234567890/artifact_viewing_abcdefghijklmnop/derivative.enc",
        extractedTextRelativePath: null,
      },
      {
        artifactId: "artifact_contract_abcdefghijklmnop",
        caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
        kind: "contract_pdf",
        mime: "application/pdf",
        derivativeRelativePath: null,
        extractedTextRelativePath:
          "case_abcdefghijklmnopqrstuvwxyz1234567890/artifact_contract_abcdefghijklmnop/extracted-text.enc",
      },
    ]);
    const service = new RealDemoService(repository, store);
    await expect(
      service.loadAnalysisPayloads(actor, "case_abcdefghijklmnopqrstuvwxyz1234567890"),
    ).resolves.toHaveLength(3);
    expect(store.read).toHaveBeenCalledTimes(3);
  });

  it("rejects incomplete or cross-case metadata before reading encrypted files", async () => {
    const { repository, store } = dependencies();
    vi.mocked(repository.listAvailableArtifacts).mockResolvedValueOnce([
      {
        artifactId: "artifact_listing_abcdefghijklmnop",
        caseId: "case_other_abcdefghijklmnopqrstuvwxyz",
        kind: "listing_image",
        mime: "image/png",
        derivativeRelativePath: "case_other/artifact_listing_abcdefghijklmnop/derivative.enc",
        extractedTextRelativePath: null,
      },
      {
        artifactId: "artifact_viewing_abcdefghijklmnop",
        caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
        kind: "viewing_image",
        mime: "image/jpeg",
        derivativeRelativePath:
          "case_abcdefghijklmnopqrstuvwxyz1234567890/artifact_viewing_abcdefghijklmnop/derivative.enc",
        extractedTextRelativePath: null,
      },
      {
        artifactId: "artifact_contract_abcdefghijklmnop",
        caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
        kind: "contract_pdf",
        mime: "application/pdf",
        derivativeRelativePath: null,
        extractedTextRelativePath:
          "case_abcdefghijklmnopqrstuvwxyz1234567890/artifact_contract_abcdefghijklmnop/extracted-text.enc",
      },
    ]);
    const service = new RealDemoService(repository, store);
    await expect(
      service.loadAnalysisPayloads(actor, "case_abcdefghijklmnopqrstuvwxyz1234567890"),
    ).rejects.toThrow("REAL_DEMO_STORAGE_FAILED");

    vi.mocked(repository.listAvailableArtifacts).mockResolvedValueOnce([]);
    await expect(
      service.loadAnalysisPayloads(actor, "case_abcdefghijklmnopqrstuvwxyz1234567890"),
    ).rejects.toThrow("REAL_DEMO_ARTIFACT_SET_INCOMPLETE");
    expect(store.read).not.toHaveBeenCalled();
  });
});
import { createHash } from "node:crypto";
