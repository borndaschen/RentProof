import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  guardRequest: vi.fn(() => true),
  guardUpload: vi.fn(),
  resolveActor: vi.fn(),
  saveArtifact: vi.fn(),
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
  getRealDemoRuntime: async () => ({ service: { saveArtifact: mocks.saveArtifact } }),
}));
vi.mock("@/application/uploads", () => ({ guardSingleUploadRequest: mocks.guardUpload }));
vi.mock("@/application/video", () => ({
  prepareVideoEvidence: mocks.prepareVideo,
  packVerifiedVideoFrames: mocks.packFrames,
}));
vi.mock("@/adapters/ingestion/ffmpeg", () => ({
  createApprovedWindowsFfmpegAdapters: mocks.createAdapters,
}));
vi.mock("@/adapters/documents/pdfjs", () => ({ extractTextPdf: vi.fn(), pdfJsEngine: {} }));
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

  it("uses only the approved runtime, bundles verified frames and stores the original privately", async () => {
    const response = await POST(videoRequest(), { params: Promise.resolve({ caseId }) });
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createAdapters).toHaveBeenCalledWith({
      runtimeRoot: "C:\\Users\\tester\\AppData\\Local\\RentProof\\runtime",
    });
    expect(mocks.prepareVideo).toHaveBeenCalledWith(
      expect.objectContaining({ declaredMime: "video/mp4", byteLength: videoBytes.byteLength }),
      videoBytes,
      { marker: "approved" },
    );
    expect(mocks.saveArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        caseId,
        kind: "viewing_video",
        mime: "video/mp4",
        originalBytes: videoBytes,
        derivative: expect.objectContaining({ bytes: bundle }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      artifactId: "artifact_video_000000000001",
      kind: "viewing_video",
      mime: "video/mp4",
    });
  });

  it("fails closed without saving when runtime processing rejects the video", async () => {
    mocks.prepareVideo.mockResolvedValueOnce({ ok: false, code: "VIDEO_DURATION_EXCEEDED" });
    const response = await POST(videoRequest(), { params: Promise.resolve({ caseId }) });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VIDEO_DURATION_EXCEEDED" },
    });
    expect(mocks.saveArtifact).not.toHaveBeenCalled();
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
