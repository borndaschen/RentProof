import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { win32 } from "node:path";
import { z } from "zod";
import { writeAtomicUtf8 } from "../json-state/windows-json-state-filesystem";
import {
  RUNTIME_OWNERSHIP_MARKER_FILENAME,
  RuntimeOwnershipMarkerSchema,
  validateCleanupTarget,
  type RuntimeOwnershipMarker,
} from "./cleanup-policy";
import { WindowsRuntimePolicyError, type WindowsRuntimeErrorCode } from "./errors";
import {
  RUNTIME_RUN_MANIFEST_FILENAME,
  RuntimeRunManifestSchema,
  validateOwnedRuntimeRun,
  type RuntimeRunManifest,
  type ValidatedWindowsRuntimeRun,
} from "./owned-run";
import type { WindowsRuntimePlatformProbe } from "./platform-probe";
import type { RuntimePathBoundaries } from "./path-policy";
import type { ValidatedWindowsRuntimePath } from "./preflight";

const ROOT_MARKER_FILENAME = ".rentproof-runtime-root.json";
const CLEANUP_LOCK_FILENAME = ".rentproof-cleanup.lock";
const MAX_CONTROL_FILE_BYTES = 64 * 1024;
const DEVELOPMENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const RuntimeRootMarkerSchema = z
  .object({
    schema: z.literal("rentproof.runtime-root.v1"),
    ownerId: z.string().uuid(),
    runtimeRoot: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

type RuntimeRootMarker = z.infer<typeof RuntimeRootMarkerSchema>;

export interface RuntimeLifecycleOptions extends RuntimePathBoundaries {
  runtime: ValidatedWindowsRuntimePath;
  probe: WindowsRuntimePlatformProbe;
  now?: () => Date;
  processId?: number;
  isProcessAlive?: (processId: number) => boolean;
}

export interface RuntimeCleanupReport {
  deletedRunNames: string[];
  skipped: Array<{ runName: string; reasonCode: WindowsRuntimeErrorCode }>;
}

export class WindowsRuntimeRunHandle {
  readonly run: ValidatedWindowsRuntimeRun;
  readonly #now: () => Date;
  #manifest: RuntimeRunManifest;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(run: ValidatedWindowsRuntimeRun, now: () => Date) {
    this.run = run;
    this.#manifest = run.manifest;
    this.#now = now;
  }

  async touch(writtenAt = this.#now()): Promise<void> {
    await this.#mutate(async () => {
      const next = RuntimeRunManifestSchema.parse({
        ...this.#manifest,
        lastWrittenAt: writtenAt.toISOString(),
      });
      await writeAtomicUtf8(
        win32.join(this.run.runPath, RUNTIME_RUN_MANIFEST_FILENAME),
        json(next),
      );
      this.#manifest = next;
    });
  }

  async stop(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#manifest.status === "stopped") return;
      const next = RuntimeRunManifestSchema.parse({ ...this.#manifest, status: "stopped" });
      await writeAtomicUtf8(
        win32.join(this.run.runPath, RUNTIME_RUN_MANIFEST_FILENAME),
        json(next),
      );
      this.#manifest = next;
    });
  }

  async #mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.#mutationTail.then(operation);
    this.#mutationTail = next.catch(() => undefined);
    await next;
  }
}

export async function createWindowsRuntimeRun(
  options: RuntimeLifecycleOptions,
  runKind: "development" | "formal_demo",
): Promise<WindowsRuntimeRunHandle> {
  const now = options.now ?? (() => new Date());
  const root = await ensureRootMarker(options, now());
  const prefix = runKind === "formal_demo" ? "formal-demo" : "development";
  const runName = `${prefix}-${randomUUID()}`;
  const runPath = win32.join(options.runtime.path, runName);
  try {
    await mkdir(runPath, { recursive: false });
  } catch (error: unknown) {
    throw new WindowsRuntimePolicyError(
      isNodeError(error, "EEXIST") ? "RUNTIME_RUN_ALREADY_EXISTS" : "RUNTIME_IO_FAILED",
      { cause: error },
    );
  }

  const createdAt = now().toISOString();
  const marker: RuntimeOwnershipMarker = {
    schema: "rentproof.runtime-owner.v1",
    ownerId: root.ownerId,
    runtimeRoot: options.runtime.path,
    targetName: runName,
    runKind,
    createdAt,
  };
  const manifest: RuntimeRunManifest = {
    schema: "rentproof.runtime-run.v1",
    ownerId: root.ownerId,
    runKind,
    createdAt,
    lastWrittenAt: createdAt,
    status: "active",
    processId: options.processId ?? process.pid,
    instanceId: randomUUID(),
  };

  try {
    await writeExclusiveSynced(
      win32.join(runPath, RUNTIME_OWNERSHIP_MARKER_FILENAME),
      json(RuntimeOwnershipMarkerSchema.parse(marker)),
    );
    await writeExclusiveSynced(
      win32.join(runPath, RUNTIME_RUN_MANIFEST_FILENAME),
      json(RuntimeRunManifestSchema.parse(manifest)),
    );
    await mkdir(win32.join(runPath, "state"), { recursive: false });
    const run = await validateOwnedRuntimeRun(
      {
        ...boundaries(options),
        runtimeRoot: options.runtime.path,
        runPath,
        marker,
        manifest,
        expectedOwnerId: root.ownerId,
      },
      options.probe,
    );
    return new WindowsRuntimeRunHandle(run, now);
  } catch (error: unknown) {
    await rollbackFreshRun(runPath);
    throw error;
  }
}

export async function cleanupWindowsRuntime(
  options: RuntimeLifecycleOptions,
  mode: "development_expired_and_abandoned_formal" | "abandoned_formal_only",
): Promise<RuntimeCleanupReport> {
  const now = options.now ?? (() => new Date());
  const root = await ensureRootMarker(options, now());
  const lockPath = win32.join(options.runtime.path, CLEANUP_LOCK_FILENAME);
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(`${process.pid}\n`, { encoding: "utf8" });
    await lock.sync();
  } catch (error: unknown) {
    throw new WindowsRuntimePolicyError(
      isNodeError(error, "EEXIST") ? "RUNTIME_CLEANUP_LOCK_BUSY" : "RUNTIME_IO_FAILED",
      { cause: error },
    );
  }

  const report: RuntimeCleanupReport = { deletedRunNames: [], skipped: [] };
  try {
    const entries = await readdir(options.runtime.path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runName = entry.name;
      const runPath = win32.join(options.runtime.path, runName);
      try {
        const marker = RuntimeOwnershipMarkerSchema.parse(
          await readControlJson(win32.join(runPath, RUNTIME_OWNERSHIP_MARKER_FILENAME)),
        );
        const manifest = RuntimeRunManifestSchema.parse(
          await readControlJson(win32.join(runPath, RUNTIME_RUN_MANIFEST_FILENAME)),
        );
        if (marker.ownerId !== root.ownerId || manifest.ownerId !== root.ownerId) {
          throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_MARKER_MISMATCH");
        }
        const alive = (options.isProcessAlive ?? defaultIsProcessAlive)(manifest.processId);
        const active = manifest.status === "active" && alive;
        const lastWritten = Date.parse(manifest.lastWrittenAt);
        const expiredDevelopment =
          marker.runKind === "development" &&
          mode === "development_expired_and_abandoned_formal" &&
          now().getTime() - lastWritten >= DEVELOPMENT_RETENTION_MS;
        const abandonedFormal = marker.runKind === "formal_demo" && !active;
        if (!expiredDevelopment && !abandonedFormal) continue;

        await validateCleanupTarget(
          {
            ...boundaries(options),
            runtimeRoot: options.runtime.path,
            targetPath: runPath,
            marker,
            expectedOwnerId: root.ownerId,
            cleanupLockAcquired: true,
            runActive: active,
          },
          options.probe,
        );
        await removeTreeWithoutFollowing(runPath, options.probe);
        report.deletedRunNames.push(runName);
      } catch (error: unknown) {
        report.skipped.push({ runName, reasonCode: reasonCode(error) });
      }
    }
    return report;
  } finally {
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

export async function cleanupStoppedFormalRun(
  options: RuntimeLifecycleOptions,
  handle: WindowsRuntimeRunHandle,
): Promise<void> {
  await handle.stop();
  const report = await cleanupWindowsRuntime(options, "abandoned_formal_only");
  const runName = win32.basename(handle.run.runPath);
  if (!report.deletedRunNames.includes(runName)) {
    const skipped = report.skipped.find(
      (entry) => entry.runName.toLowerCase() === runName.toLowerCase(),
    );
    throw new WindowsRuntimePolicyError(skipped?.reasonCode ?? "RUNTIME_RUN_NOT_FOUND");
  }
}

async function ensureRootMarker(
  options: RuntimeLifecycleOptions,
  now: Date,
): Promise<RuntimeRootMarker> {
  await mkdir(options.runtime.path, { recursive: true });
  const inspected = await options.probe.inspectPath(options.runtime.path);
  if (
    inspected.volumeKind !== "fixed" ||
    inspected.hasReparsePointInPath ||
    !samePath(inspected.resolvedPath, options.runtime.path)
  ) {
    throw new WindowsRuntimePolicyError(
      inspected.hasReparsePointInPath
        ? "RUNTIME_REPARSE_POINT_DISALLOWED"
        : inspected.volumeKind !== "fixed"
          ? "RUNTIME_VOLUME_NOT_FIXED"
          : "RUNTIME_PATH_INVALID",
    );
  }
  const path = win32.join(options.runtime.path, ROOT_MARKER_FILENAME);
  try {
    const parsed = RuntimeRootMarkerSchema.parse(await readControlJson(path));
    if (!samePath(parsed.runtimeRoot, options.runtime.path)) {
      throw new WindowsRuntimePolicyError("RUNTIME_ROOT_MARKER_INVALID");
    }
    return parsed;
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) {
      if (error instanceof WindowsRuntimePolicyError) throw error;
      throw new WindowsRuntimePolicyError("RUNTIME_ROOT_MARKER_INVALID", { cause: error });
    }
  }

  const marker = RuntimeRootMarkerSchema.parse({
    schema: "rentproof.runtime-root.v1",
    ownerId: randomUUID(),
    runtimeRoot: options.runtime.path,
    createdAt: now.toISOString(),
  });
  try {
    await writeExclusiveSynced(path, json(marker));
    return marker;
  } catch (error: unknown) {
    if (isNodeError(error, "EEXIST")) {
      return RuntimeRootMarkerSchema.parse(await readControlJson(path));
    }
    throw error;
  }
}

async function writeExclusiveSynced(path: string, text: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(text, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
  } catch (error: unknown) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    throw error;
  }
}

async function readControlJson(path: string): Promise<unknown> {
  const raw = await readFile(path);
  if (raw.byteLength > MAX_CONTROL_FILE_BYTES) {
    throw new WindowsRuntimePolicyError("RUNTIME_RUN_MANIFEST_INVALID");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error: unknown) {
    throw new WindowsRuntimePolicyError("RUNTIME_RUN_MANIFEST_INVALID", { cause: error });
  }
}

async function removeTreeWithoutFollowing(
  target: string,
  probe: WindowsRuntimePlatformProbe,
): Promise<void> {
  const entries = await collectSafeTree(target, probe);
  for (const entry of entries) {
    if (entry.kind === "file") await unlink(entry.path);
    else await rmdir(entry.path);
  }
}

async function collectSafeTree(
  target: string,
  probe: WindowsRuntimePlatformProbe,
): Promise<Array<{ path: string; kind: "file" | "directory" }>> {
  const stat = await lstat(target);
  const inspection = await probe.inspectPath(target);
  if (stat.isSymbolicLink() || inspection.hasReparsePointInPath) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_REPARSE_DESCENDANT");
  }
  if (stat.isDirectory()) {
    const collected: Array<{ path: string; kind: "file" | "directory" }> = [];
    const entries = await readdir(target);
    for (const entry of entries) {
      collected.push(...(await collectSafeTree(win32.join(target, entry), probe)));
    }
    collected.push({ path: target, kind: "directory" });
    return collected;
  }
  if (!stat.isFile()) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_TARGET_INVALID");
  }
  return [{ path: target, kind: "file" }];
}

async function rollbackFreshRun(runPath: string): Promise<void> {
  await unlink(win32.join(runPath, RUNTIME_RUN_MANIFEST_FILENAME)).catch(() => undefined);
  await unlink(win32.join(runPath, RUNTIME_OWNERSHIP_MARKER_FILENAME)).catch(() => undefined);
  await rmdir(win32.join(runPath, "state")).catch(() => undefined);
  await rmdir(runPath).catch(() => undefined);
}

function defaultIsProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function boundaries(options: RuntimeLifecycleOptions): RuntimePathBoundaries {
  return {
    repositoryRoot: options.repositoryRoot,
    demoRoot: options.demoRoot,
    publicRoot: options.publicRoot,
    userProfile: options.userProfile,
    ...(options.documentsRoots === undefined ? {} : { documentsRoots: options.documentsRoots }),
    ...(options.oneDriveRoots === undefined ? {} : { oneDriveRoots: options.oneDriveRoots }),
  };
}

function samePath(left: string, right: string): boolean {
  return (
    win32
      .normalize(left)
      .replace(/[\\/]+$/u, "")
      .toLowerCase() ===
    win32
      .normalize(right)
      .replace(/[\\/]+$/u, "")
      .toLowerCase()
  );
}

function json(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function reasonCode(error: unknown): WindowsRuntimeErrorCode {
  return error instanceof WindowsRuntimePolicyError ? error.code : "RUNTIME_IO_FAILED";
}
