import { createHash } from "node:crypto";
import { z } from "zod";
import type { ActorContext } from "@/application/repositories";
import type { EncryptedRealArtifactStorePort } from "@/application/real-demo";
import { PrepareScannedPdfOcr } from "@/application/ocr";
import {
  ConfirmableOcrPagesSchema,
  createOcrConfirmation,
  validateOcrConfirmation,
} from "@/application/ocr/confirm-ocr";
import { JobHandlerError, type JobHandler } from "@/application/jobs/job-worker";
import { PersistentBoundedJobQueue } from "@/application/jobs";
import {
  ProcessingRecordSchema,
  processingActorRef,
  type PreparedArtifactWriter,
  type ProcessingRecord,
  type ProcessingRepository,
} from "./contracts";

const keySchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
const CandidateSchema = z
  .object({ pages: ConfirmableOcrPagesSchema, provenance: z.unknown() })
  .strict();

export class ArtifactProcessingService {
  constructor(
    private readonly dependencies: {
      repository: ProcessingRepository;
      store: EncryptedRealArtifactStorePort & PreparedArtifactWriter;
      queue: PersistentBoundedJobQueue;
      ocr: () => PrepareScannedPdfOcr;
      prepareVideo: (artifactId: string, bytes: Uint8Array) => Promise<Uint8Array>;
      assertCloudAvailable: () => void;
      nextId: () => string;
      now: () => number;
    },
  ) {}

  async enqueue(input: {
    actor: ActorContext;
    caseId: string;
    type: ProcessingRecord["type"];
    bytes: Uint8Array;
    sha256: string;
    idempotencyKey: string;
  }) {
    const { repository, store } = this.dependencies;
    keySchema.parse(input.idempotencyKey);
    const current = await repository.authorize(input.actor, input.caseId);
    if (input.type === "contract.ocr") this.dependencies.assertCloudAvailable();
    if (hash(input.bytes) !== input.sha256) throw new Error("PROCESSING_HASH_INVALID");
    const idempotencyHash = hash(
      `${processingActorRef(input.actor)}\n${input.caseId}\n${input.idempotencyKey}`,
    );
    const existing = await repository.findByKey(input.actor, input.caseId, idempotencyHash);
    if (existing) {
      if (existing.reservation.originalSha256 !== input.sha256 || existing.type !== input.type)
        throw new Error("JOB_IDEMPOTENCY_CONFLICT");
      return this.enqueueRecord(existing);
    }
    const reservation = {
      artifactId: this.dependencies.nextId(),
      caseId: input.caseId,
      kind: input.type === "contract.ocr" ? ("contract_pdf" as const) : ("viewing_video" as const),
      mime: input.type === "contract.ocr" ? ("application/pdf" as const) : ("video/mp4" as const),
      originalSha256: input.sha256,
      originalBytes: input.bytes.byteLength,
    };
    // Validate limits before writing any private bytes.
    const provisional = ProcessingRecordSchema.parse({
      actor: input.actor,
      reservation,
      idempotencyHash,
      expectedRevision: current.revision,
      policyHash: current.policyHash,
      type: input.type,
      state: "queued",
      stored: {
        originalRelativePath: `${input.caseId}/${reservation.artifactId}/original.enc`,
        derivativeRelativePath: null,
        extractedTextRelativePath: null,
        derivativeSha256: null,
        derivativeBytes: null,
      },
      confirmation: null,
      reasonCode: null,
      jobId: null,
    });
    let saved = false;
    try {
      const stored = await store.save({ reservation, originalBytes: input.bytes });
      const record = { ...provisional, stored };
      await repository.create(record);
      saved = true;
      return await this.enqueueRecord(record);
    } finally {
      if (!saved) await store.deleteArtifact(reservation);
    }
  }

  private async enqueueRecord(record: ProcessingRecord) {
    if (record.jobId || record.state !== "queued") return this.receipt(record);
    const result = await this.dependencies.queue.enqueue({
      actorRef: processingActorRef(record.actor),
      idempotencyKey: record.idempotencyHash,
      priority: "normal",
      work: {
        type: record.type,
        caseId: record.reservation.caseId,
        artifactId: record.reservation.artifactId,
        expectedRevision: record.expectedRevision,
      },
    });
    if (!result.ok) throw new Error(result.code);
    const next = { ...record, jobId: result.jobId };
    await this.dependencies.repository.replace(next, "queued");
    return this.receipt(next);
  }

  async status(actor: ActorContext, caseId: string, artifactId: string) {
    const record = await this.requireRecord(actor, caseId, artifactId);
    if (record.state === "requires_confirmation") {
      const current = await this.dependencies.repository.authorize(actor, caseId);
      const confirmation = record.confirmation;
      if (
        !confirmation ||
        current.revision !== record.expectedRevision ||
        current.policyHash !== record.policyHash
      ) {
        return {
          ...this.receipt(record),
          state: "failed" as const,
          reasonCode: "OCR_CONFIRMATION_STALE",
        };
      }
      if (this.dependencies.now() >= confirmation.expiresAtMs) {
        return {
          ...this.receipt(record),
          state: "failed" as const,
          reasonCode: "OCR_CONFIRMATION_EXPIRED",
        };
      }
      const candidate = await this.readCandidate(record);
      return {
        ...this.receipt(record),
        confirmationId: confirmation.confirmationId,
        expiresAt: new Date(confirmation.expiresAtMs).toISOString(),
        pages: candidate.pages,
      };
    }
    if (record.state === "queued" && record.jobId) {
      const job = await this.dependencies.queue.get({
        actorRef: processingActorRef(actor),
        caseId,
        jobId: record.jobId,
      });
      if (!job)
        return {
          ...this.receipt(record),
          state: "failed" as const,
          reasonCode: "PROCESSING_JOB_EXPIRED",
        };
      if (job.state === "failed" || job.state === "cancelled") {
        return { ...this.receipt(record), state: job.state, reasonCode: job.reasonCode };
      }
      return {
        ...this.receipt(record),
        state: job.state === "running" ? ("running" as const) : record.state,
      };
    }
    return this.receipt(record);
  }

  async confirm(actor: ActorContext, caseId: string, artifactId: string, confirmationId: string) {
    const record = await this.requireRecord(actor, caseId, artifactId);
    if (record.state === "available") throw new Error("OCR_CONFIRMATION_USED");
    if (record.state !== "requires_confirmation")
      throw new Error("OCR_HUMAN_CONFIRMATION_REQUIRED");
    const current = await this.dependencies.repository.authorize(actor, caseId);
    const candidate = await this.readCandidate(record);
    const nowMs = this.dependencies.now();
    const pages = validateOcrConfirmation({
      pending: record.confirmation,
      pages: candidate.pages,
      actor,
      caseId,
      artifactId,
      confirmationId,
      revision: current.revision,
      policyHash: current.policyHash,
      explicitlyConfirmed: true,
      nowMs,
    });
    const stored = await this.dependencies.store.writePrepared({
      reservation: record.reservation,
      extractedText: JSON.stringify({
        pages,
        provenance: candidate.provenance,
        source: "human_verified_ocr",
      }),
    });
    await this.dependencies.repository.finalize(record, stored, { confirmationId, pages, nowMs });
    return {
      schemaVersion: "rentproof.real-artifact-receipt.v1",
      artifactId,
      kind: "contract_pdf" as const,
      mime: "application/pdf" as const,
    };
  }

  async cancel(actor: ActorContext, caseId: string, artifactId: string): Promise<void> {
    const record = await this.requireRecord(actor, caseId, artifactId);
    if (record.state === "available") throw new Error("PROCESSING_ALREADY_AVAILABLE");
    if (record.jobId) {
      const result = await this.dependencies.queue.cancel({
        actorRef: processingActorRef(actor),
        caseId,
        jobId: record.jobId,
        expectedRevision: record.expectedRevision,
      });
      if (
        !result.ok &&
        result.code !== "JOB_NOT_CANCELLABLE" &&
        result.code !== "JOB_NOT_FOUND_OR_FORBIDDEN"
      )
        throw new Error(result.code);
    }
    await this.dependencies.repository.replace(
      { ...record, state: "cancelled", confirmation: null, reasonCode: "JOB_CANCELLED" },
      record.state,
    );
    await this.dependencies.store.deleteArtifact(record.reservation);
  }

  readonly handle: JobHandler = async (work, context) => {
    if (work.type === "analysis.pipeline")
      throw new JobHandlerError("PROCESSING_TYPE_DISABLED", false);
    const record = await this.dependencies.repository.findWork(
      context.actorRef,
      work.caseId,
      work.artifactId,
    );
    if (!record || record.type !== work.type)
      throw new JobHandlerError("JOB_OWNER_GATE_FAILED", false);
    if (record.state === "available" || record.state === "requires_confirmation")
      return { resultRef: work.artifactId };
    if (record.state !== "queued") throw new JobHandlerError("PROCESSING_STATE_STALE", false);
    await context.assertActive();
    try {
      const bytes = await this.dependencies.store.read(record.stored.originalRelativePath);
      if (
        bytes.byteLength !== record.reservation.originalBytes ||
        hash(bytes) !== record.reservation.originalSha256
      ) {
        throw new JobHandlerError("PROCESSING_HASH_INVALID", false);
      }
      if (work.type === "contract.ocr") {
        this.dependencies.assertCloudAvailable();
        const result = await this.dependencies
          .ocr()
          .execute({ caseId: work.caseId, artifactId: work.artifactId, bytes });
        if (result.assessment.status !== "requires_confirmation")
          throw new JobHandlerError(result.assessment.reasonCode, false);
        await context.assertActive();
        const candidate = createOcrConfirmation({
          assessment: result.assessment,
          actor: record.actor,
          caseId: work.caseId,
          artifactId: work.artifactId,
          expectedRevision: record.expectedRevision,
          policyHash: record.policyHash,
          confirmationId: this.dependencies.nextId(),
          nowMs: this.dependencies.now(),
        });
        const candidateBytes = new TextEncoder().encode(
          JSON.stringify({ pages: candidate.pages, provenance: result.provenance }),
        );
        const stored = await this.dependencies.store.writePrepared({
          reservation: record.reservation,
          derivative: { bytes: candidateBytes, sha256: hash(candidateBytes) },
        });
        await context.assertActive();
        await this.dependencies.repository.replace(
          {
            ...record,
            stored,
            confirmation: candidate.confirmation,
            state: "requires_confirmation",
          },
          "queued",
        );
      } else {
        const bundle = await this.dependencies.prepareVideo(work.artifactId, bytes);
        await context.assertActive();
        const stored = await this.dependencies.store.writePrepared({
          reservation: record.reservation,
          derivative: { bytes: bundle, sha256: hash(bundle) },
        });
        await context.assertActive();
        await this.dependencies.repository.finalize(record, stored);
      }
      return { resultRef: work.artifactId };
    } catch (error) {
      const code =
        error instanceof Error &&
        /^(OCR_|PDF_|VIDEO_|PROCESSING_|JOB_)[A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : "PROCESSING_FAILED";
      try {
        await this.dependencies.repository.replace(
          { ...record, state: "failed", reasonCode: code, confirmation: null },
          "queued",
        );
        await this.dependencies.store.deleteArtifact(record.reservation);
      } catch {
        // A revoked owner, stale revision, or concurrent cancellation must not be overwritten.
        // Case deletion/retention remains responsible for any inaccessible private residue.
      }
      throw new JobHandlerError(code, false);
    }
  };

  private async requireRecord(actor: ActorContext, caseId: string, artifactId: string) {
    const record = await this.dependencies.repository.find(actor, caseId, artifactId);
    if (!record) throw new Error("PROCESSING_NOT_FOUND_OR_FORBIDDEN");
    return record;
  }

  private async readCandidate(record: ProcessingRecord) {
    const path = record.stored.derivativeRelativePath;
    if (path !== `${record.reservation.caseId}/${record.reservation.artifactId}/derivative.enc`)
      throw new Error("OCR_CANDIDATE_INVALID");
    const bytes = await this.dependencies.store.read(path);
    if (hash(bytes) !== record.stored.derivativeSha256) throw new Error("OCR_CANDIDATE_INVALID");
    return CandidateSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
    );
  }

  private receipt(record: ProcessingRecord) {
    return {
      schemaVersion: "rentproof.processing-receipt.v1" as const,
      artifactId: record.reservation.artifactId,
      kind: record.reservation.kind,
      mime: record.reservation.mime,
      state: record.state,
      reasonCode: record.reasonCode,
    };
  }
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
