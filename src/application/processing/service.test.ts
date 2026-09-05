import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrepareScannedPdfOcr } from "@/application/ocr";
import { validateOcrConfirmation } from "@/application/ocr/confirm-ocr";
import { PersistentBoundedJobQueue } from "@/application/jobs";
import { ArtifactProcessingService } from "./service";
import {
  processingActorRef,
  type ProcessingRecord,
  type ProcessingRepository,
  type PreparedArtifactWriter,
} from "./contracts";
import type { EncryptedRealArtifactStorePort } from "@/application/real-demo";

const actor = {
  kind: "user",
  userId: "user_000000000000000001",
  sessionId: "session_000000000000001",
} as const;
const caseId = "case_000000000000000001";
const bytes = new TextEncoder().encode("%PDF-synthetic-private-test");
const sha256 = createHash("sha256").update(bytes).digest("hex");

function setup() {
  let queueText: string | null = null;
  let now = 1_000;
  let revision = 0;
  let sequence = 0;
  const records = new Map<string, ProcessingRecord>();
  const files = new Map<string, Uint8Array>();
  const nextId = () => `opaque_${String(++sequence).padStart(24, "0")}`;
  const queue = new PersistentBoundedJobQueue({
    store: {
      readText: async () => queueText,
      writeTextIfUnchanged: async (expected, next) => {
        if (expected !== queueText) return false;
        queueText = next;
        return true;
      },
    },
    clock: () => now,
    idGenerator: nextId,
  });
  const repository: ProcessingRepository = {
    authorize: vi.fn(async () => ({ revision, policyHash: "a".repeat(64) })),
    find: vi.fn(async (_actor, _case, artifactId) => records.get(artifactId) ?? null),
    findByKey: vi.fn(
      async (_actor, _case, key) =>
        [...records.values()].find((record) => record.idempotencyHash === key) ?? null,
    ),
    findWork: vi.fn(async (_actor, _case, artifactId) => records.get(artifactId) ?? null),
    create: vi.fn(async (record) => {
      records.set(record.reservation.artifactId, structuredClone(record));
    }),
    replace: vi.fn(async (record) => {
      records.set(record.reservation.artifactId, structuredClone(record));
    }),
    finalize: vi.fn(async (record, stored, confirmation) => {
      const current = records.get(record.reservation.artifactId);
      if (!current) throw new Error("PROCESSING_NOT_FOUND_OR_FORBIDDEN");
      if (confirmation)
        validateOcrConfirmation({
          pending: current.confirmation,
          pages: confirmation.pages,
          actor,
          caseId,
          artifactId: record.reservation.artifactId,
          confirmationId: confirmation.confirmationId,
          revision,
          policyHash: "a".repeat(64),
          explicitlyConfirmed: true,
          nowMs: now,
        });
      records.set(record.reservation.artifactId, { ...current, stored, state: "available" });
      revision += 1;
    }),
  };
  const store: EncryptedRealArtifactStorePort & PreparedArtifactWriter = {
    save: vi.fn(async ({ reservation, originalBytes }) => {
      const path = `${reservation.caseId}/${reservation.artifactId}/original.enc`;
      files.set(path, originalBytes);
      return {
        originalRelativePath: path,
        derivativeRelativePath: null,
        extractedTextRelativePath: null,
        derivativeBytes: null,
        derivativeSha256: null,
      };
    }),
    writePrepared: vi.fn(async ({ reservation, derivative, extractedText }) => {
      const prefix = `${reservation.caseId}/${reservation.artifactId}`;
      if (derivative) files.set(`${prefix}/derivative.enc`, derivative.bytes);
      if (extractedText)
        files.set(`${prefix}/extracted-text.enc`, new TextEncoder().encode(extractedText));
      return {
        originalRelativePath: `${prefix}/original.enc`,
        derivativeRelativePath: derivative ? `${prefix}/derivative.enc` : null,
        extractedTextRelativePath: extractedText ? `${prefix}/extracted-text.enc` : null,
        derivativeBytes: derivative?.bytes.byteLength ?? null,
        derivativeSha256: derivative?.sha256 ?? null,
      };
    }),
    read: vi.fn(async (path) => {
      const value = files.get(path);
      if (!value) throw new Error("FILE_MISSING");
      return value;
    }),
    deleteArtifact: vi.fn(async () => undefined),
    deleteCase: vi.fn(async () => undefined),
  };
  const recognize = vi.fn(async () => ({
    output: {
      pages: [
        {
          page: 1,
          quality: "clear",
          lines: [{ text: "租金 12000 元", confidence: 0.99, bbox: [0, 0, 1, 1] }],
        },
      ],
    },
    provenance: {
      stage: "contract.ocr" as const,
      provider: "fixture",
      requestedModel: "fixture",
      resolvedModel: "fixture",
      promptVersion: "fixture.v1",
      schemaVersion: "fixture.v1",
      providerAttempts: 0,
    },
  }));
  const assertCloudAvailable = vi.fn();
  const prepareVideo = vi.fn(async () => Uint8Array.of(4, 5, 6));
  const service = new ArtifactProcessingService({
    repository,
    store,
    queue,
    ocr: () => new PrepareScannedPdfOcr({ inspect: async () => ({ pageCount: 1 }) }, { recognize }),
    prepareVideo,
    assertCloudAvailable,
    nextId,
    now: () => now,
  });
  const enqueue = (
    type: ProcessingRecord["type"] = "contract.ocr",
    idempotencyKey = "idempotency_000000000001",
  ) => service.enqueue({ actor, caseId, type, bytes, sha256, idempotencyKey });
  const assertActive = vi.fn(async () => undefined);
  const run = async (artifactId: string, type: ProcessingRecord["type"] = "contract.ocr") =>
    service.handle(
      { type, caseId, artifactId, expectedRevision: 0 },
      {
        jobId: "job_00000000000000000001",
        actorRef: processingActorRef(actor),
        attempt: 1,
        assertActive,
      },
    );
  return {
    service,
    repository,
    store,
    queue,
    records,
    files,
    recognize,
    assertCloudAvailable,
    prepareVideo,
    enqueue,
    run,
    assertActive,
    setNow: (value: number) => {
      now = value;
    },
    setRevision: (value: number) => {
      revision = value;
    },
  };
}

describe("private artifact processing", () => {
  it("does not delete private content when cleanup loses its owner transaction", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    test.recognize.mockRejectedValueOnce(new Error("OCR_PROVIDER_REFUSED"));
    vi.mocked(test.repository.replace).mockRejectedValueOnce(
      new Error("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN"),
    );
    await expect(test.run(receipt.artifactId)).rejects.toThrow("OCR_PROVIDER_REFUSED");
    expect(test.store.deleteArtifact).not.toHaveBeenCalled();
  });
  it("projects queued, running and failed jobs without inventing a successful receipt", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    expect(await test.service.status(actor, caseId, receipt.artifactId)).toMatchObject({
      state: "queued",
    });
    const claimed = await test.queue.claim("worker_00000000000000001", ["contract.ocr"]);
    if (!claimed) throw new Error("CLAIM_MISSING");
    expect(await test.service.status(actor, caseId, receipt.artifactId)).toMatchObject({
      state: "running",
    });
    await test.queue.fail({
      jobId: claimed.jobId,
      leaseId: claimed.leaseId,
      workerId: "worker_00000000000000001",
      reasonCode: "OCR_PROVIDER_REFUSED",
      retryable: false,
    });
    expect(await test.service.status(actor, caseId, receipt.artifactId)).toMatchObject({
      state: "failed",
      reasonCode: "OCR_PROVIDER_REFUSED",
    });
    await test.queue.purgeDeletedCase(caseId);
    expect(await test.service.status(actor, caseId, receipt.artifactId)).toMatchObject({
      state: "failed",
      reasonCode: "PROCESSING_JOB_EXPIRED",
    });
    await test.service.cancel(actor, caseId, receipt.artifactId);
    expect(test.store.deleteArtifact).toHaveBeenCalledTimes(1);
  });

  it("does not rerun OCR after a completed candidate is recovered", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    await test.run(receipt.artifactId);
    expect(await test.run(receipt.artifactId)).toEqual({ resultRef: receipt.artifactId });
    expect(test.recognize).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown jobs, premature confirmation and modified original bytes", async () => {
    const test = setup();
    await expect(test.service.status(actor, caseId, "artifact_missing_00000001")).rejects.toThrow(
      "PROCESSING_NOT_FOUND_OR_FORBIDDEN",
    );
    await expect(test.run("artifact_missing_00000001")).rejects.toThrow("JOB_OWNER_GATE_FAILED");
    const receipt = await test.enqueue();
    await expect(
      test.service.confirm(actor, caseId, receipt.artifactId, "confirmation_00000000001"),
    ).rejects.toThrow("OCR_HUMAN_CONFIRMATION_REQUIRED");
    test.files.set(`${caseId}/${receipt.artifactId}/original.enc`, Uint8Array.of(1));
    await expect(test.run(receipt.artifactId)).rejects.toThrow("PROCESSING_HASH_INVALID");
    expect(test.recognize).not.toHaveBeenCalled();
  });

  it("rejects tampered candidate bytes before publishing a contract", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    await test.run(receipt.artifactId);
    test.files.set(
      `${caseId}/${receipt.artifactId}/derivative.enc`,
      new TextEncoder().encode("{}"),
    );
    await expect(test.service.status(actor, caseId, receipt.artifactId)).rejects.toThrow(
      "OCR_CANDIDATE_INVALID",
    );
    expect(test.repository.finalize).not.toHaveBeenCalled();
  });

  it("reports low quality as insufficient and hides unexpected provider error details", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    test.recognize.mockResolvedValueOnce({
      output: { pages: [{ page: 1, quality: "unclear", lines: [] }] },
      provenance: {
        stage: "contract.ocr",
        provider: "fixture",
        requestedModel: "fixture",
        resolvedModel: "fixture",
        promptVersion: "fixture.v1",
        schemaVersion: "fixture.v1",
        providerAttempts: 0,
      },
    });
    await expect(test.run(receipt.artifactId)).rejects.toThrow("OCR_PAGE_UNCLEAR");
    expect(test.store.deleteArtifact).toHaveBeenCalledTimes(1);
    const failed = setup();
    const other = await failed.enqueue();
    failed.recognize.mockRejectedValueOnce(new Error("private provider body"));
    await expect(failed.run(other.artifactId)).rejects.toThrow("PROCESSING_FAILED");
    expect(test.store.writePrepared).not.toHaveBeenCalled();
  });

  it("does not cancel an artifact already published to the case", async () => {
    const test = setup();
    const receipt = await test.enqueue("evidence.video_frames");
    await test.run(receipt.artifactId, "evidence.video_frames");
    await expect(test.service.cancel(actor, caseId, receipt.artifactId)).rejects.toThrow(
      "PROCESSING_ALREADY_AVAILABLE",
    );
    expect(test.store.deleteArtifact).not.toHaveBeenCalled();
  });
  it("keeps OCR out of analysis until explicit confirmation and preserves page locators", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    expect(receipt.state).toBe("queued");
    expect(test.recognize).not.toHaveBeenCalled();
    await test.run(receipt.artifactId);
    expect(test.repository.finalize).not.toHaveBeenCalled();
    const status = await test.service.status(actor, caseId, receipt.artifactId);
    expect(status.state).toBe("requires_confirmation");
    if (!("confirmationId" in status)) throw new Error("MISSING_CONFIRMATION");
    await test.service.confirm(actor, caseId, receipt.artifactId, status.confirmationId);
    expect(test.repository.finalize).toHaveBeenCalledTimes(1);
    const payload = test.files.get(`${caseId}/${receipt.artifactId}/extracted-text.enc`);
    expect(JSON.parse(new TextDecoder().decode(payload))).toMatchObject({
      source: "human_verified_ocr",
      pages: [{ page: 1, text: "租金 12000 元", segments: [{ bbox: [0, 0, 1, 1] }] }],
    });
    await expect(
      test.service.confirm(actor, caseId, receipt.artifactId, status.confirmationId),
    ).rejects.toThrow("OCR_CONFIRMATION_USED");
  });
  it("reuses the same opaque upload key without another private write", async () => {
    const test = setup();
    const first = await test.enqueue();
    expect(await test.enqueue()).toEqual(first);
    expect(test.store.save).toHaveBeenCalledTimes(1);
    await expect(
      test.service.enqueue({
        actor,
        caseId,
        type: "evidence.video_frames",
        bytes,
        sha256,
        idempotencyKey: "idempotency_000000000001",
      }),
    ).rejects.toThrow("JOB_IDEMPOTENCY_CONFLICT");
  });
  it("refuses cloud-disabled OCR before saving any file", async () => {
    const test = setup();
    test.assertCloudAvailable.mockImplementation(() => {
      throw new Error("OCR_LIVE_GATE_REQUIRED");
    });
    await expect(test.enqueue()).rejects.toThrow("OCR_LIVE_GATE_REQUIRED");
    expect(test.store.save).not.toHaveBeenCalled();
  });
  it("fails malformed hashes and removes files if repository creation fails", async () => {
    const test = setup();
    await expect(
      test.service.enqueue({
        actor,
        caseId,
        type: "contract.ocr",
        bytes,
        sha256: "b".repeat(64),
        idempotencyKey: "idempotency_000000000001",
      }),
    ).rejects.toThrow("PROCESSING_HASH_INVALID");
    vi.mocked(test.repository.create).mockRejectedValueOnce(new Error("DATABASE_UNAVAILABLE"));
    await expect(test.enqueue()).rejects.toThrow("DATABASE_UNAVAILABLE");
    expect(test.store.deleteArtifact).toHaveBeenCalledTimes(1);
  });
  it("never writes a candidate after the execution gate is revoked", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    test.assertActive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("JOB_OWNER_GATE_FAILED"));
    await expect(test.run(receipt.artifactId)).rejects.toThrow("JOB_OWNER_GATE_FAILED");
    expect(test.store.writePrepared).not.toHaveBeenCalled();
  });
  it("refuses stale or expired OCR confirmation without writing contract text", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    await test.run(receipt.artifactId);
    const status = await test.service.status(actor, caseId, receipt.artifactId);
    if (!("confirmationId" in status)) throw new Error("MISSING_CONFIRMATION");
    test.setRevision(1);
    await expect(
      test.service.confirm(actor, caseId, receipt.artifactId, status.confirmationId),
    ).rejects.toThrow("OCR_CONFIRMATION_STALE");
    expect(await test.service.status(actor, caseId, receipt.artifactId)).toMatchObject({
      state: "failed",
      reasonCode: "OCR_CONFIRMATION_STALE",
    });
    test.setRevision(0);
    test.setNow(601_000);
    await expect(
      test.service.confirm(actor, caseId, receipt.artifactId, status.confirmationId),
    ).rejects.toThrow("OCR_CONFIRMATION_EXPIRED");
    expect(await test.service.status(actor, caseId, receipt.artifactId)).toMatchObject({
      reasonCode: "OCR_CONFIRMATION_EXPIRED",
    });
    expect(test.repository.finalize).not.toHaveBeenCalled();
  });
  it("publishes verified video frames only after the final execution gate", async () => {
    const test = setup();
    const receipt = await test.enqueue("evidence.video_frames");
    await test.run(receipt.artifactId, "evidence.video_frames");
    expect(test.prepareVideo).toHaveBeenCalledWith(receipt.artifactId, bytes);
    expect(test.assertActive).toHaveBeenCalledTimes(3);
    expect(await test.service.status(actor, caseId, receipt.artifactId)).toMatchObject({
      state: "available",
    });
    expect(test.assertCloudAvailable).not.toHaveBeenCalled();
  });
  it("cancels queued work, deletes private bytes and never confirms it", async () => {
    const test = setup();
    const receipt = await test.enqueue();
    await test.service.cancel(actor, caseId, receipt.artifactId);
    expect(await test.service.status(actor, caseId, receipt.artifactId)).toMatchObject({
      state: "cancelled",
    });
    expect(test.store.deleteArtifact).toHaveBeenCalledTimes(1);
    await expect(test.run(receipt.artifactId)).rejects.toThrow("PROCESSING_STATE_STALE");
    expect(test.recognize).not.toHaveBeenCalled();
  });
});
