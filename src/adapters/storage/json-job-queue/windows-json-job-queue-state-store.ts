import { mkdir, readFile, stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { JobQueueStateStore } from "@/application/jobs";
import { WindowsRuntimePolicyError } from "../windows-runtime/errors";
import type { ValidatedWindowsRuntimeRun } from "../windows-runtime/owned-run";
import type { WindowsRuntimePlatformProbe } from "../windows-runtime/platform-probe";
import { writeAtomicUtf8 } from "../json-state/windows-json-state-filesystem";

const MAX_QUEUE_TEXT_BYTES = 32 * 1024 * 1024;
const locks = new Map<string, Promise<void>>();

export interface WindowsJsonJobQueueStateStoreOptions {
  run: ValidatedWindowsRuntimeRun;
  probe: WindowsRuntimePlatformProbe;
  onSuccessfulWrite?: (writtenAt: Date) => Promise<void>;
}

/** Stores exactly one queue snapshot under a validated, app-owned runtime run. */
export class WindowsJsonJobQueueStateStore implements JobQueueStateStore {
  readonly #target: string;
  readonly #probe: WindowsRuntimePlatformProbe;
  readonly #onSuccessfulWrite: ((writtenAt: Date) => Promise<void>) | undefined;

  constructor(options: WindowsJsonJobQueueStateStoreOptions) {
    this.#target = win32.join(options.run.statePath, "jobs", "job-queue.json");
    this.#probe = options.probe;
    this.#onSuccessfulWrite = options.onSuccessfulWrite;
  }

  async readText(): Promise<string | null> {
    await this.#validateTarget();
    return readNullable(this.#target);
  }

  async writeTextIfUnchanged(expectedText: string | null, nextText: string): Promise<boolean> {
    if (Buffer.byteLength(nextText, "utf8") > MAX_QUEUE_TEXT_BYTES) {
      throw new WindowsRuntimePolicyError("RUNTIME_STATE_TOO_LARGE");
    }
    return withKeyLock(this.#target, async () => {
      await this.#validateTarget();
      const current = await readNullable(this.#target);
      if (current !== expectedText) return false;
      await mkdir(win32.dirname(this.#target), { recursive: true });
      await this.#validateTarget();
      await writeAtomicUtf8(this.#target, nextText);
      await this.#onSuccessfulWrite?.(new Date());
      return true;
    });
  }

  async #validateTarget(): Promise<void> {
    const inspection = await this.#probe.inspectPath(this.#target);
    if (inspection.volumeKind !== "fixed") {
      throw new WindowsRuntimePolicyError("RUNTIME_VOLUME_NOT_FIXED");
    }
    if (inspection.hasReparsePointInPath) {
      throw new WindowsRuntimePolicyError("RUNTIME_REPARSE_POINT_DISALLOWED");
    }
    if (win32.normalize(inspection.resolvedPath).toLowerCase() !== this.#target.toLowerCase()) {
      throw new WindowsRuntimePolicyError("RUNTIME_STORAGE_KEY_INVALID");
    }
  }
}

async function readNullable(path: string): Promise<string | null> {
  try {
    const metadata = await stat(path);
    if (metadata.size > MAX_QUEUE_TEXT_BYTES) {
      throw new WindowsRuntimePolicyError("RUNTIME_STATE_TOO_LARGE");
    }
    return await readFile(path, { encoding: "utf8" });
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    if (error instanceof WindowsRuntimePolicyError) throw error;
    throw new WindowsRuntimePolicyError("RUNTIME_IO_FAILED", { cause: error });
  }
}

async function withKeyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  locks.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release?.();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
