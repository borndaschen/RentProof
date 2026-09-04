import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareVideoEvidence } from "@/application/video";
import type { VideoProcessRunner } from "./node-process-runner";
import {
  WindowsFfmpegFrameExtractor,
  WindowsFfmpegToolIdentityProbe,
  WindowsFfprobeMetadataAdapter,
  createApprovedWindowsFfmpegAdapters,
  isWindowsLocalAppDataVirtualization,
} from "./windows-ffmpeg-adapters";

const roots: string[] = [];
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
  "base64",
);
const mp4Bytes = new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
const execFileAsync = promisify(execFile);
const installedRuntimeRoot = resolve(process.env["LOCALAPPDATA"] ?? "", "RentProof", "runtime");
const installedFfmpeg = resolve(installedRuntimeRoot, "tools", "ffmpeg-9.0.1", "bin", "ffmpeg.exe");

async function fixture() {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "rentproof-video-runtime-"));
  roots.push(runtimeRoot);
  const bin = join(runtimeRoot, "tools", "ffmpeg-9.0.1", "bin");
  await mkdir(bin, { recursive: true });
  const ffmpegPath = join(bin, "ffmpeg.exe");
  const ffprobePath = join(bin, "ffprobe.exe");
  await writeFile(ffmpegPath, "ffmpeg-binary");
  await writeFile(ffprobePath, "ffprobe-binary");
  return {
    runtimeRoot,
    ffmpegPath,
    ffprobePath,
    workRoot: join(runtimeRoot, "cache", "video"),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
});

describe("Windows FFmpeg adapters", () => {
  it("recognizes only the exact Windows packaged-app LocalCache mirror", () => {
    const local = "C:\\Users\\Demo\\AppData\\Local";
    const logical = `${local}\\RentProof\\runtime\\cache\\video`;
    expect(
      isWindowsLocalAppDataVirtualization(
        logical,
        `${local}\\Packages\\OpenAI.Codex_id\\LocalCache\\Local\\RentProof\\runtime\\cache\\video`,
        local,
      ),
    ).toBe(process.platform === "win32");
    expect(
      isWindowsLocalAppDataVirtualization(
        logical,
        `${local}\\Packages\\OpenAI.Codex_id\\LocalCache\\Local\\RentProof\\other`,
        local,
      ),
    ).toBe(false);
    expect(
      isWindowsLocalAppDataVirtualization(
        logical,
        "C:\\Users\\Demo\\outside\\RentProof\\runtime\\cache\\video",
        local,
      ),
    ).toBe(false);
  });

  it.runIf(
    process.platform === "win32" &&
      existsSync(installedFfmpeg) &&
      process.env["RENTPROOF_FFMPEG_INTEGRATION"] === "1",
  )(
    "processes a real synthetic MP4 with the pinned local runtime",
    async () => {
      const sourceRoot = await mkdtemp(join(tmpdir(), "rentproof-real-ffmpeg-"));
      roots.push(sourceRoot);
      const source = join(sourceRoot, "source.mp4");
      await execFileAsync(
        installedFfmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=320x240:d=2:r=25",
          "-an",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-y",
          source,
        ],
        { windowsHide: true, timeout: 15_000 },
      );
      const bytes = new Uint8Array(await readFile(source));
      const adapters = createApprovedWindowsFfmpegAdapters({ runtimeRoot: installedRuntimeRoot });
      await expect(adapters.runtime.check()).resolves.toMatchObject({ ready: true });
      await expect(adapters.probe.inspect(bytes)).resolves.toMatchObject({
        container: "mp4",
        width: 320,
        height: 240,
      });
      const result = await prepareVideoEvidence(
        {
          artifactId: "synthetic_video_runtime_01",
          declaredMime: "video/mp4",
          byteLength: bytes.byteLength,
        },
        bytes,
        adapters,
      );
      expect(result).toMatchObject({ ok: true, audioAnalyzed: false });
      if (result.ok) {
        expect(result.frames).toHaveLength(1);
        expect(result.frames[0]).toMatchObject({ width: 320, height: 240, timestampMs: 0 });
      }
    },
    30_000,
  );

  it("requires an absolute preflight-approved runtime root", () => {
    expect(() => createApprovedWindowsFfmpegAdapters({ runtimeRoot: "relative-runtime" })).toThrow(
      "VIDEO_RUNTIME_PATH_INVALID",
    );
  });

  it("identifies only the exact controlled binary path with streaming SHA-256", async () => {
    const paths = await fixture();
    const runner: VideoProcessRunner = {
      run: vi.fn().mockResolvedValue({ stdout: "ffmpeg version pinned\nmore", stderr: "" }),
    };
    await expect(
      new WindowsFfmpegToolIdentityProbe(paths, runner).identify("ffmpeg"),
    ).resolves.toEqual({
      sha256: createHash("sha256").update("ffmpeg-binary").digest("hex"),
      version: "ffmpeg version pinned",
    });
    expect(runner.run).toHaveBeenCalledWith(paths.ffmpegPath, ["-version"], {
      timeoutMs: 5_000,
      maxOutputBytes: 65_536,
    });
  });

  it("rejects paths outside the controlled runtime tree", async () => {
    const paths = await fixture();
    const runner: VideoProcessRunner = { run: vi.fn() };
    await expect(
      new WindowsFfmpegToolIdentityProbe(
        { ...paths, ffmpegPath: resolve(paths.runtimeRoot, "evil.exe") },
        runner,
      ).identify("ffmpeg"),
    ).rejects.toThrow("VIDEO_RUNTIME_PATH_INVALID");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("probes MP4 bytes with network protocols excluded and always removes the workspace", async () => {
    const paths = await fixture();
    const runner: VideoProcessRunner = {
      run: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.001" },
          streams: [
            { codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30000/1001" },
            { codec_type: "audio" },
          ],
        }),
        stderr: "",
      }),
    };
    const bytes = mp4Bytes;
    await expect(new WindowsFfprobeMetadataAdapter(paths, runner).inspect(bytes)).resolves.toEqual({
      container: "mp4",
      durationMs: 2_001,
      width: 1920,
      height: 1080,
      frameRate: 30000 / 1001,
      videoStreamCount: 1,
      audioStreamCount: 1,
    });
    expect(runner.run).toHaveBeenCalledWith(
      paths.ffprobePath,
      expect.arrayContaining(["-protocol_whitelist", "file"]),
      { timeoutMs: 10_000, maxOutputBytes: 65_536 },
    );
    await expect(readdir(paths.workRoot)).resolves.toEqual([]);
  });

  it("fails closed for malformed or unexpected probe streams and cleans after failure", async () => {
    const paths = await fixture();
    const runner: VideoProcessRunner = {
      run: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          format: { format_name: "mp4", duration: "1" },
          streams: [{ codec_type: "subtitle" }],
        }),
        stderr: "",
      }),
    };
    await expect(
      new WindowsFfprobeMetadataAdapter(paths, runner).inspect(mp4Bytes),
    ).rejects.toThrow("VIDEO_PROBE_OUTPUT_INVALID");
    await expect(readdir(paths.workRoot)).resolves.toEqual([]);
  });

  it("extracts deterministic metadata-free JPEG frames within bounded output and cleans inputs", async () => {
    const paths = await fixture();
    const runner: VideoProcessRunner = {
      run: vi.fn(async (_executable, args) => {
        const output = args.at(-1);
        if (output === undefined) throw new Error("missing output");
        await writeFile(output, jpeg);
        return { stdout: "", stderr: "" };
      }),
    };
    const result = await new WindowsFfmpegFrameExtractor(paths, runner).extract({
      sourceBytes: mp4Bytes,
      inspection: {
        container: "mp4",
        durationMs: 2_001,
        width: 1,
        height: 1,
        frameRate: 30,
        videoStreamCount: 1,
        audioStreamCount: 0,
      },
      plan: [
        { frameNo: 0, timestampMs: 0 },
        { frameNo: 1, timestampMs: 2_000 },
      ],
    });
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) throw new Error("expected frames");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      mime: "image/jpeg",
      frameNo: 1,
      timestampMs: 2_000,
      width: 1,
      height: 1,
      metadataStripped: true,
    });
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      paths.ffmpegPath,
      expect.arrayContaining(["-ss", "2.000", "-an", "-sn", "-dn", "-map_metadata", "-1"]),
      { timeoutMs: 15_000, maxOutputBytes: 65_536 },
    );
    await expect(readdir(paths.workRoot)).resolves.toEqual([]);
  });

  it("removes the workspace after process failure without returning partial frames", async () => {
    const paths = await fixture();
    const runner: VideoProcessRunner = {
      run: vi.fn().mockRejectedValue(new Error("timeout")),
    };
    const adapter = new WindowsFfmpegFrameExtractor(paths, runner);
    await expect(
      adapter.extract({
        sourceBytes: mp4Bytes,
        inspection: {
          container: "mp4",
          durationMs: 1,
          width: 1,
          height: 1,
          frameRate: 1,
          videoStreamCount: 1,
          audioStreamCount: 0,
        },
        plan: [{ frameNo: 0, timestampMs: 0 }],
      }),
    ).rejects.toThrow("timeout");
    await expect(readdir(paths.workRoot)).resolves.toEqual([]);
  });

  it("does not accept an empty or oversized extraction plan", async () => {
    const paths = await fixture();
    const runner: VideoProcessRunner = { run: vi.fn() };
    const adapter = new WindowsFfmpegFrameExtractor(paths, runner);
    const base = {
      sourceBytes: mp4Bytes,
      inspection: {
        container: "mp4" as const,
        durationMs: 1,
        width: 1,
        height: 1,
        frameRate: 1,
        videoStreamCount: 1 as const,
        audioStreamCount: 0,
      },
    };
    await expect(adapter.extract({ ...base, plan: [] })).rejects.toThrow(
      "VIDEO_FRAME_PLAN_INVALID",
    );
    await expect(
      adapter.extract({
        ...base,
        plan: Array.from({ length: 16 }, (_, frameNo) => ({ frameNo, timestampMs: frameNo })),
      }),
    ).rejects.toThrow("VIDEO_FRAME_PLAN_INVALID");
    expect(runner.run).not.toHaveBeenCalled();
  });
});
