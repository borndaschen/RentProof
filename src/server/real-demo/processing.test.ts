import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostgresRuntime } from "@/adapters/database/postgres";
import type { EncryptedRealArtifactStore } from "@/adapters/storage/encrypted-real-artifacts";
import type { ArtifactProcessingService } from "@/application/processing/service";
import type { JobExecutionGate } from "@/application/jobs";
import { InMemoryEvidenceBudgetRepository } from "@/application/analysis-budget";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  environment: {
    RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo",
    RENTPROOF_LLM_MODE: "fixture",
    OPENAI_PROJECT_LIMITS_CONFIRMED: "false",
  },
  dependencies: undefined as unknown,
  gate: undefined as unknown,
  findWork: vi.fn(),
  authorize: vi.fn(),
  handler: vi.fn(),
  runOnce: vi.fn(),
  prepareVideo: vi.fn(),
  pack: vi.fn(),
  createOcr: vi.fn(),
}));
vi.mock("@/server/env", () => ({ getServerEnvironment: () => mocks.environment }));
vi.mock("@/adapters/database/postgres/processing-repository", () => ({
  PostgresProcessingRepository: class {
    findWork = mocks.findWork;
    authorize = mocks.authorize;
  },
  PostgresJobQueueStateStore: class {},
}));
vi.mock("@/application/processing/service", () => ({
  ArtifactProcessingService: class {
    constructor(input: unknown) {
      mocks.dependencies = input;
    }
    handle = mocks.handler;
  },
}));
vi.mock("@/application/jobs/job-worker", async (original) => ({
  ...(await original<typeof import("@/application/jobs/job-worker")>()),
  GovernedJobWorker: class {
    constructor(_queue: unknown, gate: unknown) {
      mocks.gate = gate;
    }
    runOnce = mocks.runOnce;
  },
}));
vi.mock("@/adapters/documents/pdfjs", () => ({
  pdfJsEngine: {},
  createScannedPdfPreflightAdapter: () => ({ inspect: async () => ({ pageCount: 1 }) }),
}));
vi.mock("@/adapters/openai/ocr/adapter", () => ({
  createOpenAIScannedPdfOcrAdapter: mocks.createOcr,
}));
vi.mock("@/adapters/ingestion/ffmpeg", () => ({
  createApprovedWindowsFfmpegAdapters: () => ({ approved: true }),
}));
vi.mock("@/application/video", () => ({
  prepareVideoEvidence: mocks.prepareVideo,
  packVerifiedVideoFrames: mocks.pack,
}));
import { composeArtifactProcessing } from "./processing";

const work = {
  type: "contract.ocr",
  caseId: "case_000000000000000001",
  artifactId: "artifact_000000000000001",
  expectedRevision: 1,
} as const;
const actor = {
  kind: "user",
  userId: "user_000000000000000001",
  sessionId: "session_000000000000001",
} as const;
function compose() {
  return composeArtifactProcessing(
    {} as PostgresRuntime["database"],
    {} as EncryptedRealArtifactStore,
    new InMemoryEvidenceBudgetRepository({ now: () => new Date() }),
  );
}
function dependencies() {
  return mocks.dependencies as ConstructorParameters<typeof ArtifactProcessingService>[0];
}
function gate() {
  return mocks.gate as JobExecutionGate;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.environment.RENTPROOF_LLM_MODE = "fixture";
  mocks.environment.OPENAI_PROJECT_LIMITS_CONFIRMED = "false";
  mocks.findWork.mockResolvedValue({
    actor,
    type: "contract.ocr",
    state: "queued",
    policyHash: "a",
  });
  mocks.authorize.mockResolvedValue({ revision: 1, policyHash: "a" });
  mocks.runOnce.mockResolvedValue({ status: "idle" });
  mocks.prepareVideo.mockResolvedValue({ ok: true, frames: [] });
  mocks.pack.mockReturnValue(Uint8Array.of(1));
  mocks.createOcr.mockReturnValue({ recognize: vi.fn() });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("processing runtime composition", () => {
  it("does not assemble a live OCR adapter in fixture or unconfirmed project mode", async () => {
    const runtime = compose();
    try {
      expect(() => dependencies().ocr()).toThrow("OCR_LIVE_GATE_REQUIRED");
      mocks.environment.RENTPROOF_LLM_MODE = "live";
      expect(() => dependencies().ocr()).toThrow("OCR_LIVE_GATE_REQUIRED");
      mocks.environment.OPENAI_PROJECT_LIMITS_CONFIRMED = "true";
      vi.stubEnv("OPENAI_API_KEY", "");
      expect(() => dependencies().ocr()).toThrow("OCR_LIVE_GATE_REQUIRED");
      expect(mocks.createOcr).not.toHaveBeenCalled();
      vi.stubEnv("OPENAI_API_KEY", "synthetic-test-only");
      expect(dependencies().ocr()).toBeDefined();
    } finally {
      await runtime.stop();
    }
  });
  it("requires a configured runtime before invoking approved video preparation", async () => {
    const runtime = compose();
    try {
      vi.stubEnv("LOCALAPPDATA", "");
      vi.stubEnv("RENTPROOF_RUNTIME_DIR", "");
      await expect(dependencies().prepareVideo(work.artifactId, Uint8Array.of(1))).rejects.toThrow(
        "VIDEO_RUNTIME_UNAVAILABLE",
      );
      vi.stubEnv("LOCALAPPDATA", "C:\\Users\\synthetic\\AppData\\Local");
      expect(await dependencies().prepareVideo(work.artifactId, Uint8Array.of(1))).toEqual(
        Uint8Array.of(1),
      );
      mocks.prepareVideo.mockResolvedValueOnce({ ok: false, code: "VIDEO_DURATION_EXCEEDED" });
      await expect(dependencies().prepareVideo(work.artifactId, Uint8Array.of(1))).rejects.toThrow(
        "VIDEO_DURATION_EXCEEDED",
      );
    } finally {
      await runtime.stop();
    }
  });
  it("rechecks owner, revision, policy and cloud conditions before dispatch", async () => {
    const runtime = compose();
    const input = {
      jobId: "job_00000000000000000001",
      actorRef: actor.sessionId,
      work,
      attempt: 1,
    };
    try {
      expect(await gate().authorize(input)).toMatchObject({ ok: false });
      mocks.environment.RENTPROOF_LLM_MODE = "live";
      mocks.environment.OPENAI_PROJECT_LIMITS_CONFIRMED = "true";
      expect(await gate().authorize(input)).toEqual({ ok: true });
      mocks.authorize.mockResolvedValueOnce({ revision: 2, policyHash: "a" });
      expect(await gate().authorize(input)).toEqual({
        ok: false,
        reasonCode: "JOB_REVISION_STALE",
      });
      mocks.authorize.mockResolvedValueOnce({ revision: 1, policyHash: "changed" });
      expect(await gate().authorize(input)).toEqual({
        ok: false,
        reasonCode: "JOB_POLICY_GATE_FAILED",
      });
      mocks.findWork.mockResolvedValueOnce(null);
      expect(await gate().authorize(input)).toEqual({
        ok: false,
        reasonCode: "JOB_OWNER_GATE_FAILED",
      });
      mocks.findWork.mockRejectedValueOnce(new Error("private database failure"));
      expect(await gate().authorize(input)).toEqual({
        ok: false,
        reasonCode: "JOB_OWNER_GATE_FAILED",
      });
      expect(
        await gate().authorize({
          ...input,
          work: { type: "analysis.pipeline", caseId: work.caseId, expectedRevision: 1 },
        }),
      ).toEqual({ ok: false, reasonCode: "JOB_POLICY_GATE_FAILED" });
    } finally {
      await runtime.stop();
    }
  });
  it("does not overlap pump cycles and stops claiming after shutdown", async () => {
    const runtime = compose();
    runtime.pump();
    runtime.pump();
    expect(mocks.runOnce).toHaveBeenCalledTimes(2);
    await runtime.stop();
    runtime.pump();
    expect(mocks.runOnce).toHaveBeenCalledTimes(2);
  });
});
