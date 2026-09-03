import { win32 } from "node:path";
import { WindowsRuntimePolicyError } from "./errors";

const WINDOWS_DEVICE_OR_UNC = /^(?:\\\\|\/\/|\\\\[?.]\\)/u;

function normalizedComparisonPath(path: string): string {
  const normalized = win32.normalize(path).replace(/[\\/]+$/u, "");
  return normalized.toLowerCase();
}

export function pathsOverlap(left: string, right: string): boolean {
  const leftKey = normalizedComparisonPath(left);
  const rightKey = normalizedComparisonPath(right);
  return (
    leftKey === rightKey ||
    leftKey.startsWith(`${rightKey}\\`) ||
    rightKey.startsWith(`${leftKey}\\`)
  );
}

export function assertAbsoluteLocalWindowsPath(path: string): string {
  if (path.length === 0 || path !== path.trim() || path.includes("\0")) {
    throw new WindowsRuntimePolicyError("RUNTIME_PATH_INVALID");
  }
  if (WINDOWS_DEVICE_OR_UNC.test(path)) {
    throw new WindowsRuntimePolicyError("RUNTIME_PATH_UNC_DISALLOWED");
  }
  if (!win32.isAbsolute(path) || !/^[a-z]:[\\/]/iu.test(path)) {
    throw new WindowsRuntimePolicyError("RUNTIME_PATH_INVALID");
  }

  const segments = path.slice(3).split(/[\\/]/u);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new WindowsRuntimePolicyError("RUNTIME_PATH_INVALID");
  }

  const normalized = win32.normalize(path);
  if (
    normalizedComparisonPath(normalized) === normalizedComparisonPath(win32.parse(normalized).root)
  ) {
    throw new WindowsRuntimePolicyError("RUNTIME_PATH_ROOT_DISALLOWED");
  }
  return normalized;
}

export interface RuntimePathBoundaries {
  repositoryRoot: string;
  demoRoot: string;
  publicRoot: string;
  userProfile: string;
  documentsRoots?: readonly string[];
  oneDriveRoots?: readonly string[];
}

export function runtimeForbiddenRoots(boundaries: RuntimePathBoundaries): string[] {
  return [
    boundaries.repositoryRoot,
    boundaries.demoRoot,
    boundaries.publicRoot,
    win32.join(boundaries.userProfile, "Documents"),
    win32.join(boundaries.userProfile, "OneDrive"),
    ...(boundaries.documentsRoots ?? []),
    ...(boundaries.oneDriveRoots ?? []),
  ].map(assertAbsoluteLocalWindowsPath);
}

export function assertNoRuntimeBoundaryOverlap(
  runtimePath: string,
  boundaries: RuntimePathBoundaries,
): void {
  const normalizedRuntime = assertAbsoluteLocalWindowsPath(runtimePath);
  if (runtimeForbiddenRoots(boundaries).some((root) => pathsOverlap(normalizedRuntime, root))) {
    throw new WindowsRuntimePolicyError("RUNTIME_PATH_OVERLAP_DISALLOWED");
  }
}

export function resolveRuntimePath(options: {
  explicitRuntimeDir?: string | undefined;
  localAppData?: string | undefined;
}): string {
  if (options.explicitRuntimeDir !== undefined && options.explicitRuntimeDir !== "") {
    return assertAbsoluteLocalWindowsPath(options.explicitRuntimeDir);
  }
  if (options.localAppData === undefined || options.localAppData === "") {
    throw new WindowsRuntimePolicyError("RUNTIME_LOCALAPPDATA_MISSING");
  }
  return assertAbsoluteLocalWindowsPath(win32.join(options.localAppData, "RentProof", "runtime"));
}
