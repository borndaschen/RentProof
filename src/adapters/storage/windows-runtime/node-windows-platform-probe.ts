import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { win32 } from "node:path";
import { WindowsRuntimePolicyError } from "./errors";
import type {
  WindowsPathInspection,
  WindowsRuntimePlatformProbe,
  WindowsVolumeKind,
} from "./platform-probe";

export interface NodeWindowsPlatformProbeOptions {
  platform?: NodeJS.Platform;
  resolveVolumeKind?: (driveRoot: string) => Promise<WindowsVolumeKind>;
  inspectReparsePoint?: (path: string) => Promise<boolean>;
}

/** Windows-only infrastructure probe. Policy stays in preflight/cleanup modules. */
export class NodeWindowsRuntimePlatformProbe implements WindowsRuntimePlatformProbe {
  readonly #platform: NodeJS.Platform;
  readonly #resolveVolumeKind: (driveRoot: string) => Promise<WindowsVolumeKind>;
  readonly #inspectReparsePoint: (path: string) => Promise<boolean>;

  constructor(options: NodeWindowsPlatformProbeOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    this.#resolveVolumeKind = options.resolveVolumeKind ?? resolveWindowsVolumeKind;
    this.#inspectReparsePoint = options.inspectReparsePoint ?? inspectWindowsReparsePoint;
  }

  async inspectPath(path: string): Promise<WindowsPathInspection> {
    if (this.#platform !== "win32") {
      throw new WindowsRuntimePolicyError("RUNTIME_PLATFORM_UNSUPPORTED");
    }
    const normalized = win32.normalize(path);
    const { existingAncestor, missingSegments } = await nearestExistingAncestor(normalized);
    const canonicalAncestor = await realpath(existingAncestor);
    const resolvedPath = win32.join(canonicalAncestor, ...missingSegments);
    const driveRoot = win32.parse(resolvedPath).root;
    let hasReparsePointInPath = false;
    for (const candidate of ancestorsBetween(driveRoot, existingAncestor)) {
      if (await this.#inspectReparsePoint(candidate)) {
        hasReparsePointInPath = true;
        break;
      }
    }
    return {
      resolvedPath,
      volumeKind: await this.#resolveVolumeKind(driveRoot),
      hasReparsePointInPath,
    };
  }
}

async function nearestExistingAncestor(
  path: string,
): Promise<{ existingAncestor: string; missingSegments: string[] }> {
  let candidate = path;
  const missingSegments: string[] = [];
  while (true) {
    try {
      await lstat(candidate);
      return { existingAncestor: candidate, missingSegments };
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) {
        throw new WindowsRuntimePolicyError("RUNTIME_IO_FAILED", { cause: error });
      }
      const parent = win32.dirname(candidate);
      if (parent === candidate) {
        throw new WindowsRuntimePolicyError("RUNTIME_ROOT_NOT_FOUND");
      }
      missingSegments.unshift(win32.basename(candidate));
      candidate = parent;
    }
  }
}

function ancestorsBetween(root: string, target: string): string[] {
  const relative = win32.relative(root, target);
  const output = [root];
  let current = root;
  for (const segment of relative.split(win32.sep).filter((value) => value.length > 0)) {
    current = win32.join(current, segment);
    output.push(current);
  }
  return output;
}

async function resolveWindowsVolumeKind(driveRoot: string): Promise<WindowsVolumeKind> {
  const drive = win32.parse(driveRoot).root.slice(0, 2);
  if (!/^[A-Z]:$/iu.test(drive)) return "unknown";
  const output = await executeFile("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$disk=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='${drive.toUpperCase()}'\"; if($null -eq $disk){exit 2}; [Console]::Out.Write($disk.DriveType)`,
  ]);
  switch (output.trim()) {
    case "3":
      return "fixed";
    case "2":
      return "removable";
    case "4":
      return "network";
    default:
      return "unknown";
  }
}

async function inspectWindowsReparsePoint(path: string): Promise<boolean> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) return true;
  return new Promise<boolean>((resolve, reject) => {
    execFile(
      "fsutil.exe",
      ["reparsepoint", "query", path],
      { windowsHide: true, encoding: "utf8" },
      (error) => {
        if (error === null) {
          resolve(true);
          return;
        }
        if ("code" in error && (error.code === 1 || error.code === "1")) {
          resolve(false);
          return;
        }
        reject(new WindowsRuntimePolicyError("RUNTIME_IO_FAILED", { cause: error }));
      },
    );
  });
}

function executeFile(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      if (error !== null) {
        reject(new WindowsRuntimePolicyError("RUNTIME_IO_FAILED", { cause: error }));
        return;
      }
      resolve(stdout);
    });
  });
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
