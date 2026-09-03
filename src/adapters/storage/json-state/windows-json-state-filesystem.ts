import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { win32 } from "node:path";
import type { JsonStateFilesystemPort } from "@/application/repositories";
import { WindowsRuntimePolicyError } from "../windows-runtime/errors";
import type { ValidatedWindowsRuntimeRun } from "../windows-runtime/owned-run";
import type { WindowsRuntimePlatformProbe } from "../windows-runtime/platform-probe";

const MAX_STATE_TEXT_BYTES = 16 * 1024 * 1024;
const STORAGE_KEY_PATTERN = /^cases\/[a-z0-9][a-z0-9_-]{15,127}\.json$/u;
const locks = new Map<string, Promise<void>>();

export interface WindowsJsonStateFilesystemOptions {
  run: ValidatedWindowsRuntimeRun;
  probe: WindowsRuntimePlatformProbe;
  onSuccessfulWrite?: (writtenAt: Date) => Promise<void>;
}

/**
 * JSON state adapter for a previously validated, app-owned runtime run.
 * It accepts only case-state keys and never exposes an arbitrary path API.
 */
export class WindowsJsonStateFilesystem implements JsonStateFilesystemPort {
  readonly #statePath: string;
  readonly #probe: WindowsRuntimePlatformProbe;
  readonly #onSuccessfulWrite: ((writtenAt: Date) => Promise<void>) | undefined;

  constructor(options: WindowsJsonStateFilesystemOptions) {
    this.#statePath = options.run.statePath;
    this.#probe = options.probe;
    this.#onSuccessfulWrite = options.onSuccessfulWrite;
  }

  async readText(storageKey: string): Promise<string | null> {
    const path = this.#resolveKey(storageKey);
    await this.#validateTarget(path);
    try {
      return await readFile(path, { encoding: "utf8" });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) return null;
      throw ioFailure(error);
    }
  }

  async writeTextIfUnchanged(
    storageKey: string,
    expectedText: string | null,
    nextText: string,
  ): Promise<boolean> {
    if (Buffer.byteLength(nextText, "utf8") > MAX_STATE_TEXT_BYTES) {
      throw new WindowsRuntimePolicyError("RUNTIME_STATE_TOO_LARGE");
    }
    const target = this.#resolveKey(storageKey);
    return withKeyLock(target, async () => {
      await this.#validateTarget(target);
      const current = await this.#readForCompare(target);
      if (current !== expectedText) return false;
      await mkdir(win32.dirname(target), { recursive: true });
      await this.#validateTarget(target);
      await writeAtomicUtf8(target, nextText);
      if (this.#onSuccessfulWrite !== undefined) {
        await this.#onSuccessfulWrite(new Date());
      }
      return true;
    });
  }

  async #readForCompare(path: string): Promise<string | null> {
    try {
      return await readFile(path, { encoding: "utf8" });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) return null;
      throw ioFailure(error);
    }
  }

  #resolveKey(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new WindowsRuntimePolicyError("RUNTIME_STORAGE_KEY_INVALID");
    }
    const target = win32.resolve(this.#statePath, ...storageKey.split("/"));
    const relative = win32.relative(this.#statePath, target);
    if (relative.startsWith("..") || win32.isAbsolute(relative)) {
      throw new WindowsRuntimePolicyError("RUNTIME_STORAGE_KEY_INVALID");
    }
    return target;
  }

  async #validateTarget(target: string): Promise<void> {
    const inspection = await this.#probe.inspectPath(target);
    if (inspection.volumeKind !== "fixed") {
      throw new WindowsRuntimePolicyError("RUNTIME_VOLUME_NOT_FIXED");
    }
    if (inspection.hasReparsePointInPath) {
      throw new WindowsRuntimePolicyError("RUNTIME_REPARSE_POINT_DISALLOWED");
    }
    if (win32.normalize(inspection.resolvedPath).toLowerCase() !== target.toLowerCase()) {
      throw new WindowsRuntimePolicyError("RUNTIME_STORAGE_KEY_INVALID");
    }
  }
}

export async function writeAtomicUtf8(target: string, text: string): Promise<void> {
  const temporary = win32.join(
    win32.dirname(target),
    `.${win32.basename(target)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(text, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } catch (error: unknown) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw ioFailure(error);
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

function ioFailure(error: unknown): WindowsRuntimePolicyError {
  return new WindowsRuntimePolicyError("RUNTIME_IO_FAILED", { cause: error });
}
