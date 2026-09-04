import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { VideoFrameExtractorPort, VideoMetadataProbePort } from "@/application/video";
import {
  VIDEO_LIMITS,
  createDeterministicFramePlan,
  hasMp4FileSignature,
  type ExtractedVideoFrame,
} from "@/domain/video";
import { verifySharpDerivative } from "@/adapters/ingestion/sharp";
import { GYAN_FFMPEG_9_0_1_ESSENTIALS_PIN } from "./approved-runtime";
import { PinnedFfmpegRuntimeGate, type TrustedVideoToolProbePort } from "./pinned-runtime-gate";
import { NodeVideoProcessRunner, type VideoProcessRunner } from "./node-process-runner";
import { SharpVideoFrameVerifier } from "./sharp-video-frame-verifier";

const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const IDENTIFY_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;
const EXTRACT_TIMEOUT_MS = 15_000;
const TOOL_DIRECTORY = join("tools", "ffmpeg-9.0.1", "bin");

type RuntimePaths = Readonly<{
  runtimeRoot: string;
  ffmpegPath: string;
  ffprobePath: string;
  workRoot: string;
}>;

type ProbeDocument = {
  format?: { format_name?: unknown; duration?: unknown };
  streams?: unknown;
};

type ProbeStream = {
  codec_type?: unknown;
  width?: unknown;
  height?: unknown;
  r_frame_rate?: unknown;
};

function isContained(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

/**
 * Windows packaged desktop apps can transparently redirect writes below LocalAppData to
 * `Packages/<package>/LocalCache/Local`. Accept only that exact OS-controlled mirror of the
 * requested logical path; arbitrary realpath divergence remains rejected.
 */
export function isWindowsLocalAppDataVirtualization(
  logicalPath: string,
  realPath: string,
  localAppData = process.env["LOCALAPPDATA"],
): boolean {
  if (process.platform !== "win32" || localAppData === undefined || localAppData === "") {
    return false;
  }
  const logicalRelative = relative(resolve(localAppData), resolve(logicalPath));
  const realRelative = relative(resolve(localAppData), resolve(realPath));
  if (
    logicalRelative === "" ||
    logicalRelative.startsWith("..") ||
    isAbsolute(logicalRelative) ||
    realRelative.startsWith("..") ||
    isAbsolute(realRelative)
  ) {
    return false;
  }
  const logicalParts = logicalRelative.split(/[\\/]/u);
  const realParts = realRelative.split(/[\\/]/u);
  if (
    realParts.length !== logicalParts.length + 4 ||
    realParts[0]?.toLowerCase() !== "packages" ||
    !/^[A-Za-z0-9._-]{1,200}$/u.test(realParts[1] ?? "") ||
    realParts[2]?.toLowerCase() !== "localcache" ||
    realParts[3]?.toLowerCase() !== "local"
  ) {
    return false;
  }
  return logicalParts.every(
    (part, index) => part.toLowerCase() === realParts[index + 4]?.toLowerCase(),
  );
}

async function assertSafeRuntimePaths(paths: RuntimePaths): Promise<void> {
  if (!isAbsolute(paths.runtimeRoot) || !isAbsolute(paths.workRoot)) {
    throw new Error("VIDEO_RUNTIME_PATH_INVALID");
  }
  const runtimeReal = await realpath(paths.runtimeRoot);
  const expectedFfmpeg = resolve(runtimeReal, TOOL_DIRECTORY, "ffmpeg.exe");
  const expectedFfprobe = resolve(runtimeReal, TOOL_DIRECTORY, "ffprobe.exe");
  if (
    resolve(paths.ffmpegPath) !== expectedFfmpeg ||
    resolve(paths.ffprobePath) !== expectedFfprobe ||
    !isContained(runtimeReal, resolve(paths.workRoot))
  ) {
    throw new Error("VIDEO_RUNTIME_PATH_INVALID");
  }
  const [ffmpegInfo, ffprobeInfo] = await Promise.all([
    lstat(paths.ffmpegPath),
    lstat(paths.ffprobePath),
  ]);
  if (
    !ffmpegInfo.isFile() ||
    ffmpegInfo.isSymbolicLink() ||
    !ffprobeInfo.isFile() ||
    ffprobeInfo.isSymbolicLink()
  ) {
    throw new Error("VIDEO_RUNTIME_PATH_INVALID");
  }
}

async function sha256File(path: string): Promise<string> {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function withVideoWorkspace<T>(
  paths: RuntimePaths,
  operation: (workspace: string) => Promise<T>,
): Promise<T> {
  await assertSafeRuntimePaths(paths);
  await mkdir(paths.workRoot, { recursive: true });
  const workRootReal = await realpath(paths.workRoot);
  const runtimeReal = await realpath(paths.runtimeRoot);
  if (
    !isContained(runtimeReal, workRootReal) &&
    !isWindowsLocalAppDataVirtualization(paths.workRoot, workRootReal)
  ) {
    throw new Error("VIDEO_WORKSPACE_INVALID");
  }
  const workRootInfo = await lstat(paths.workRoot);
  if (!workRootInfo.isDirectory() || workRootInfo.isSymbolicLink()) {
    throw new Error("VIDEO_WORKSPACE_INVALID");
  }
  // Keep filesystem operations on the logical path so Windows can consistently apply its
  // packaged-app virtualization. `realpath` remains verification-only.
  const workspace = await mkdtemp(join(paths.workRoot, "job-"));
  try {
    return await operation(workspace);
  } finally {
    const workspaceReal = await realpath(workspace).catch(() => undefined);
    if (
      workspaceReal !== undefined &&
      isContained(workRootReal, workspaceReal) &&
      basename(workspaceReal).startsWith("job-")
    ) {
      await rm(workspace, { recursive: true, force: true, maxRetries: 2 });
    }
  }
}

async function writeSource(workspace: string, bytes: Uint8Array): Promise<string> {
  if (
    bytes.byteLength < 12 ||
    bytes.byteLength > VIDEO_LIMITS.maxBytes ||
    !hasMp4FileSignature(bytes)
  ) {
    throw new Error("VIDEO_INPUT_INVALID");
  }
  const source = join(workspace, "source.mp4");
  await writeFile(source, bytes, { flag: "wx", mode: 0o600 });
  return source;
}

function parseRate(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+\/\d+$/u.test(value)) return undefined;
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0)
    return undefined;
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function parseProbeJson(stdout: string): unknown {
  let document: ProbeDocument;
  try {
    document = JSON.parse(stdout) as ProbeDocument;
  } catch {
    throw new Error("VIDEO_PROBE_OUTPUT_INVALID");
  }
  const formatName = document.format?.format_name;
  const durationSeconds = Number(document.format?.duration);
  if (
    typeof formatName !== "string" ||
    !formatName.split(",").includes("mp4") ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Array.isArray(document.streams)
  ) {
    throw new Error("VIDEO_PROBE_OUTPUT_INVALID");
  }
  const streams = document.streams as ProbeStream[];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  if (videoStreams.length !== 1 || streams.length !== videoStreams.length + audioStreams.length) {
    throw new Error("VIDEO_PROBE_OUTPUT_INVALID");
  }
  const video = videoStreams[0];
  const width = parsePositiveInteger(video?.width);
  const height = parsePositiveInteger(video?.height);
  const frameRate = parseRate(video?.r_frame_rate);
  const durationMs = Math.ceil(durationSeconds * 1_000);
  if (
    width === undefined ||
    height === undefined ||
    frameRate === undefined ||
    !Number.isSafeInteger(durationMs)
  ) {
    throw new Error("VIDEO_PROBE_OUTPUT_INVALID");
  }
  return {
    container: "mp4",
    durationMs,
    width,
    height,
    frameRate,
    videoStreamCount: 1,
    audioStreamCount: audioStreams.length,
  };
}

export class WindowsFfmpegToolIdentityProbe implements TrustedVideoToolProbePort {
  constructor(
    private readonly paths: RuntimePaths,
    private readonly runner: VideoProcessRunner = new NodeVideoProcessRunner(),
  ) {}

  async identify(tool: "ffmpeg" | "ffprobe"): Promise<unknown> {
    await assertSafeRuntimePaths(this.paths);
    const path = tool === "ffmpeg" ? this.paths.ffmpegPath : this.paths.ffprobePath;
    const [sha256, result] = await Promise.all([
      sha256File(path),
      this.runner.run(path, ["-version"], {
        timeoutMs: IDENTIFY_TIMEOUT_MS,
        maxOutputBytes: MAX_TOOL_OUTPUT_BYTES,
      }),
    ]);
    const version = result.stdout.split(/\r?\n/u)[0]?.trim();
    if (version === undefined || version === "") throw new Error("VIDEO_TOOL_VERSION_INVALID");
    return { sha256, version };
  }
}

export class WindowsFfprobeMetadataAdapter implements VideoMetadataProbePort {
  constructor(
    private readonly paths: RuntimePaths,
    private readonly runner: VideoProcessRunner = new NodeVideoProcessRunner(),
  ) {}

  async inspect(bytes: Uint8Array): Promise<unknown> {
    return await withVideoWorkspace(this.paths, async (workspace) => {
      const source = await writeSource(workspace, bytes);
      const result = await this.runner.run(
        this.paths.ffprobePath,
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file",
          "-show_entries",
          "format=format_name,duration:stream=codec_type,width,height,r_frame_rate",
          "-of",
          "json",
          source,
        ],
        { timeoutMs: PROBE_TIMEOUT_MS, maxOutputBytes: MAX_TOOL_OUTPUT_BYTES },
      );
      return parseProbeJson(result.stdout);
    });
  }
}

export class WindowsFfmpegFrameExtractor implements VideoFrameExtractorPort {
  constructor(
    private readonly paths: RuntimePaths,
    private readonly runner: VideoProcessRunner = new NodeVideoProcessRunner(),
  ) {}

  async extract(input: Parameters<VideoFrameExtractorPort["extract"]>[0]): Promise<unknown> {
    const expectedPlan = createDeterministicFramePlan(input.inspection.durationMs);
    if (
      input.plan.length < 1 ||
      input.plan.length > VIDEO_LIMITS.maxExtractedFrames ||
      input.plan.length !== expectedPlan.length ||
      input.plan.some(
        (item, index) =>
          item.frameNo !== expectedPlan[index]?.frameNo ||
          item.timestampMs !== expectedPlan[index]?.timestampMs,
      )
    ) {
      throw new Error("VIDEO_FRAME_PLAN_INVALID");
    }
    return await withVideoWorkspace(this.paths, async (workspace) => {
      const source = await writeSource(workspace, input.sourceBytes);
      const frames: ExtractedVideoFrame[] = [];
      let aggregateBytes = 0;
      for (const item of input.plan) {
        const output = join(workspace, `frame-${String(item.frameNo).padStart(2, "0")}.jpg`);
        await this.runner.run(
          this.paths.ffmpegPath,
          [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-protocol_whitelist",
            "file",
            "-ss",
            (item.timestampMs / 1_000).toFixed(3),
            "-i",
            source,
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-an",
            "-sn",
            "-dn",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-vf",
            `scale=w=min(${VIDEO_LIMITS.derivativeMaxLongEdge}\\,iw):h=min(${VIDEO_LIMITS.derivativeMaxLongEdge}\\,ih):force_original_aspect_ratio=decrease:flags=lanczos,format=yuvj420p`,
            "-q:v",
            "2",
            "-threads",
            "1",
            "-fflags",
            "+bitexact",
            "-flags:v",
            "+bitexact",
            "-y",
            output,
          ],
          { timeoutMs: EXTRACT_TIMEOUT_MS, maxOutputBytes: MAX_TOOL_OUTPUT_BYTES },
        );
        const outputInfo = await stat(output);
        if (
          !outputInfo.isFile() ||
          outputInfo.size < 1 ||
          outputInfo.size > VIDEO_LIMITS.maxFrameBytes
        ) {
          throw new Error("VIDEO_FRAME_SIZE_INVALID");
        }
        aggregateBytes += outputInfo.size;
        if (aggregateBytes > VIDEO_LIMITS.maxFrameBytes * VIDEO_LIMITS.maxExtractedFrames) {
          throw new Error("VIDEO_FRAME_TOTAL_SIZE_INVALID");
        }
        const bytes = new Uint8Array(await readFile(output));
        const verified = await verifySharpDerivative(bytes, "image/jpeg");
        if (!verified.ok) throw new Error("VIDEO_FRAME_IMAGE_INVALID");
        frames.push({
          mime: "image/jpeg",
          frameNo: item.frameNo,
          timestampMs: item.timestampMs,
          width: verified.width,
          height: verified.height,
          byteLength: bytes.byteLength,
          bytes,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          metadataStripped: true,
        });
      }
      const expectedNames = new Set([
        "source.mp4",
        ...input.plan.map((item) => `frame-${String(item.frameNo).padStart(2, "0")}.jpg`),
      ]);
      const actualNames = await readdir(workspace);
      if (
        actualNames.some((name) => !expectedNames.has(name)) ||
        actualNames.length !== expectedNames.size
      ) {
        throw new Error("VIDEO_WORKSPACE_OUTPUT_INVALID");
      }
      return frames;
    });
  }
}

export function createApprovedWindowsFfmpegAdapters(input: Readonly<{ runtimeRoot: string }>) {
  if (!isAbsolute(input.runtimeRoot)) throw new Error("VIDEO_RUNTIME_PATH_INVALID");
  const runtimeRoot = resolve(input.runtimeRoot);
  const paths: RuntimePaths = {
    runtimeRoot,
    ffmpegPath: resolve(runtimeRoot, TOOL_DIRECTORY, "ffmpeg.exe"),
    ffprobePath: resolve(runtimeRoot, TOOL_DIRECTORY, "ffprobe.exe"),
    workRoot: resolve(runtimeRoot, "cache", "video"),
  };
  const runner = new NodeVideoProcessRunner();
  return {
    runtime: new PinnedFfmpegRuntimeGate(
      GYAN_FFMPEG_9_0_1_ESSENTIALS_PIN,
      new WindowsFfmpegToolIdentityProbe(paths, runner),
    ),
    probe: new WindowsFfprobeMetadataAdapter(paths, runner),
    extractor: new WindowsFfmpegFrameExtractor(paths, runner),
    verifier: new SharpVideoFrameVerifier(),
  } as const;
}
