import "server-only";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { PostgresRuntime } from "@/adapters/database/postgres";
import {
  PostgresProcessingRepository,
  PostgresJobQueueStateStore,
} from "@/adapters/database/postgres/processing-repository";
import type { EncryptedRealArtifactStore } from "@/adapters/storage/encrypted-real-artifacts";
import { createScannedPdfPreflightAdapter, pdfJsEngine } from "@/adapters/documents/pdfjs";
import { createOpenAIScannedPdfOcrAdapter } from "@/adapters/openai/ocr/adapter";
import { createApprovedWindowsFfmpegAdapters } from "@/adapters/ingestion/ffmpeg";
import { prepareVideoEvidence, packVerifiedVideoFrames } from "@/application/video";
import { ArtifactProcessingService } from "@/application/processing/service";
import { PersistentBoundedJobQueue } from "@/application/jobs";
import { GovernedJobWorker, JobHandlerError } from "@/application/jobs/job-worker";
import { PrepareScannedPdfOcr } from "@/application/ocr";
import { BudgetedScannedPdfOcr } from "@/application/ocr/budgeted-ocr";
import { getServerEnvironment } from "@/server/env";
import type { EvidenceBudgetRepository } from "@/application/analysis-budget";

export function composeArtifactProcessing(
  database: PostgresRuntime["database"],
  store: EncryptedRealArtifactStore,
  budget: EvidenceBudgetRepository,
) {
  const nextId = () => `processing_${randomBytes(24).toString("hex")}`;
  const repository = new PostgresProcessingRepository(database);
  const queue = new PersistentBoundedJobQueue({
    store: new PostgresJobQueueStateStore(database),
    idGenerator: nextId,
  });
  const assertCloudAvailable = () => {
    const environment = getServerEnvironment();
    if (
      environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
      environment.RENTPROOF_LLM_MODE !== "live" ||
      environment.OPENAI_PROJECT_LIMITS_CONFIRMED !== "true"
    ) {
      throw new Error("OCR_LIVE_GATE_REQUIRED");
    }
  };
  const service = new ArtifactProcessingService({
    repository,
    store,
    queue,
    nextId,
    now: Date.now,
    assertCloudAvailable,
    ocr: () => {
      assertCloudAvailable();
      const key = process.env["OPENAI_API_KEY"];
      if (!key) throw new Error("OCR_LIVE_GATE_REQUIRED");
      return new PrepareScannedPdfOcr(
        createScannedPdfPreflightAdapter(pdfJsEngine),
        new BudgetedScannedPdfOcr(createOpenAIScannedPdfOcrAdapter(key), budget, nextId),
      );
    },
    prepareVideo: async (artifactId, bytes) => {
      const localAppData = process.env["LOCALAPPDATA"];
      const configuredRoot = process.env["RENTPROOF_RUNTIME_DIR"]?.trim();
      if (!configuredRoot && !localAppData) throw new Error("VIDEO_RUNTIME_UNAVAILABLE");
      const result = await prepareVideoEvidence(
        { artifactId, declaredMime: "video/mp4", byteLength: bytes.byteLength },
        bytes,
        createApprovedWindowsFfmpegAdapters({
          runtimeRoot: configuredRoot || resolve(localAppData ?? "", "RentProof", "runtime"),
        }),
      );
      if (!result.ok) throw new Error(result.code);
      return packVerifiedVideoFrames(result.frames);
    },
  });
  const worker = new GovernedJobWorker(
    queue,
    {
      authorize: async ({ actorRef, work }) => {
        if (work.type === "analysis.pipeline")
          return { ok: false, reasonCode: "JOB_POLICY_GATE_FAILED" };
        try {
          const record = await repository.findWork(actorRef, work.caseId, work.artifactId);
          if (!record || record.type !== work.type)
            return { ok: false, reasonCode: "JOB_OWNER_GATE_FAILED" };
          const current = await repository.authorize(record.actor, work.caseId);
          if (record.state !== "available" && current.revision !== work.expectedRevision)
            return { ok: false, reasonCode: "JOB_REVISION_STALE" };
          if (current.policyHash !== record.policyHash)
            return { ok: false, reasonCode: "JOB_POLICY_GATE_FAILED" };
          if (work.type === "contract.ocr") assertCloudAvailable();
          return { ok: true };
        } catch {
          return { ok: false, reasonCode: "JOB_OWNER_GATE_FAILED" };
        }
      },
    },
    {
      "contract.ocr": service.handle,
      "evidence.video_frames": service.handle,
      "analysis.pipeline": async () => {
        throw new JobHandlerError("PROCESSING_TYPE_DISABLED", false);
      },
    },
  );
  const workers = [nextId(), nextId()];
  let running: Promise<void> | undefined;
  let stopped = false;
  const pump = () => {
    if (stopped || running) return;
    running = Promise.allSettled(workers.map((id) => worker.runOnce(id)))
      .then(() => undefined)
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(pump, 1_000);
  timer.unref();
  return {
    service,
    queue,
    pump,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
