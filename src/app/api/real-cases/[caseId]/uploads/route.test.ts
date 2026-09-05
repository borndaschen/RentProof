import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  guardRequest: vi.fn(() => true),
  guardUpload: vi.fn(),
  resolveActor: vi.fn(),
  saveArtifact: vi.fn(),
  getContext: vi.fn(),
  enqueue: vi.fn(),
  prepareVideo: vi.fn(),
  packFrames: vi.fn(),
  createAdapters: vi.fn(() => ({ marker: "approved" })),
}));

vi.mock("@/server/auth/request-guard", () => ({
  validateSelfHostedAuthBinaryMutation: mocks.guardRequest,
}));
vi.mock("@/server/auth/current-actor", () => ({ resolveCurrentCaseActor: mocks.resolveActor }));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({ RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo" }),
}));
vi.mock("@/server/real-demo", () => ({
  getRealDemoRuntime: async () => ({
    service: { saveArtifact: mocks.saveArtifact, getConversationContext: mocks.getContext },
    processing: { service: { enqueue: mocks.enqueue } },
  }),
}));
vi.mock("@/application/uploads", () => ({ guardSingleUploadRequest: mocks.guardUpload }));
vi.mock("@/application/video", () => ({
  prepareVideoEvidence: mocks.prepareVideo,
  packVerifiedVideoFrames: mocks.packFrames,
}));
vi.mock("@/adapters/ingestion/ffmpeg", () => ({
  createApprovedWindowsFfmpegAdapters: mocks.createAdapters,
}));
vi.mock("@/adapters/documents/pdfjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/adapters/documents/pdfjs")>()),
  extractTextPdf: vi.fn(),
  pdfJsEngine: {},
}));
vi.mock("@/adapters/ingestion/sharp", () => ({ SharpImageSanitizer: vi.fn() }));

import { POST } from "./route";

const caseId = "case_abcdefghijklmnopqrstuvwxyz1234567890";
const actor = {
  kind: "user",
  userId: "user_abcdefghijklmnopqrstuvwxyz123456",
  sessionId: "session_abcdefghijklmnopqrstuvwxyz123",
} as const;
const videoBytes = Uint8Array.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4]);
const bundle = Uint8Array.of(9, 8, 7);

describe("POST real-case video upload", () => {
  beforeEach(() => {
    process.env["LOCALAPPDATA"] = "C:\\Users\\tester\\AppData\\Local";
    delete process.env["RENTPROOF_RUNTIME_DIR"];
    mocks.guardRequest.mockReset().mockReturnValue(true);
    mocks.resolveActor.mockReset().mockResolvedValue(actor);
    mocks.saveArtifact.mockReset().mockResolvedValue({ artifactId: "artifact_video_000000000001" });
    mocks.getContext.mockReset().mockResolvedValue({ revision: 1 });
    mocks.enqueue.mockReset().mockResolvedValue({
      artifactId: "artifact_video_000000000001",
      kind: "viewing_video",
      mime: "video/mp4",
      state: "queued",
    });
    mocks.createAdapters.mockClear();
    mocks.packFrames.mockReset().mockReturnValue(bundle);
    mocks.prepareVideo.mockReset().mockResolvedValue({
      ok: true,
      frames: [{ frameNo: 0, timestampMs: 0 }],
      audioAnalyzed: false,
    });
    mocks.guardUpload.mockReset().mockResolvedValue({
      ok: true,
      upload: {
        actualMime: "video/mp4",
        byteLength: videoBytes.byteLength,
        sha256: "a".repeat(64),
        bytes: videoBytes,
      },
    });
  });

  it("queues privately after owner verification without pretending frames are already available", async () => {
    const response = await POST(videoRequest(), { params: Promise.resolve({ caseId }) });
    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getContext).toHaveBeenCalledBefore(mocks.guardUpload);
    expect(mocks.prepareVideo).not.toHaveBeenCalled();
    expect(mocks.saveArtifact).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        caseId,
        type: "evidence.video_frames",
        bytes: videoBytes,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      artifactId: "artifact_video_000000000001",
      kind: "viewing_video",
      mime: "video/mp4",
    });
  });

  it("fails closed without saving when the processing queue cannot persist", async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error("JOB_QUEUE_CAPACITY_EXCEEDED"));
    const response = await POST(videoRequest(), { params: Promise.resolve({ caseId }) });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "REAL_DEMO_UNAVAILABLE" },
    });
    expect(mocks.saveArtifact).not.toHaveBeenCalled();
  });

  it("does not consume upload bytes for a different owner", async () => {
    mocks.getContext.mockRejectedValueOnce(new Error("REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN"));
    const response = await POST(videoRequest(), { params: Promise.resolve({ caseId }) });
    expect(response.status).toBe(404);
    expect(mocks.guardUpload).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

function videoRequest(): Request {
  return new Request(`https://127.0.0.1:3443/api/real-cases/${caseId}/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-RentProof-Upload-Filename": "upload.mp4",
      "X-RentProof-Upload-Mime": "video/mp4",
      "X-RentProof-Upload-Kind": "viewing_video",
      "Idempotency-Key": "idempotency_000000000001",
    },
    body: videoBytes,
  });
}
