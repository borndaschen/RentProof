import type { WindowsRuntimePlatformProbe } from "./platform-probe";
import {
  assertAbsoluteLocalWindowsPath,
  assertNoRuntimeBoundaryOverlap,
  resolveRuntimePath,
  type RuntimePathBoundaries,
} from "./path-policy";
import { WindowsRuntimePolicyError } from "./errors";

export interface WindowsRuntimePreflightInput extends RuntimePathBoundaries {
  explicitRuntimeDir?: string | undefined;
  localAppData?: string | undefined;
}

export interface ValidatedWindowsRuntimePath {
  path: string;
  source: "explicit" | "local_app_data_default";
}

export async function preflightWindowsRuntimePath(
  input: WindowsRuntimePreflightInput,
  probe: WindowsRuntimePlatformProbe,
): Promise<ValidatedWindowsRuntimePath> {
  const candidate = resolveRuntimePath(input);
  assertNoRuntimeBoundaryOverlap(candidate, input);

  const inspection = await probe.inspectPath(candidate);
  const resolvedPath = assertAbsoluteLocalWindowsPath(inspection.resolvedPath);
  assertNoRuntimeBoundaryOverlap(resolvedPath, input);
  if (inspection.volumeKind !== "fixed") {
    throw new WindowsRuntimePolicyError("RUNTIME_VOLUME_NOT_FIXED");
  }
  if (inspection.hasReparsePointInPath) {
    throw new WindowsRuntimePolicyError("RUNTIME_REPARSE_POINT_DISALLOWED");
  }

  return {
    path: resolvedPath,
    source:
      input.explicitRuntimeDir === undefined || input.explicitRuntimeDir === ""
        ? "local_app_data_default"
        : "explicit",
  };
}
