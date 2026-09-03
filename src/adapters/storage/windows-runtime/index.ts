export { WindowsRuntimePolicyError } from "./errors";
export type { WindowsRuntimeErrorCode } from "./errors";
export type {
  WindowsPathInspection,
  WindowsRuntimePlatformProbe,
  WindowsVolumeKind,
} from "./platform-probe";
export {
  assertAbsoluteLocalWindowsPath,
  assertNoRuntimeBoundaryOverlap,
  pathsOverlap,
  resolveRuntimePath,
  runtimeForbiddenRoots,
} from "./path-policy";
export type { RuntimePathBoundaries } from "./path-policy";
export { preflightWindowsRuntimePath } from "./preflight";
export type { ValidatedWindowsRuntimePath, WindowsRuntimePreflightInput } from "./preflight";
export {
  RUNTIME_OWNERSHIP_MARKER_FILENAME,
  RuntimeOwnershipMarkerSchema,
  validateCleanupTarget,
} from "./cleanup-policy";
export {
  RUNTIME_RUN_MANIFEST_FILENAME,
  RuntimeRunManifestSchema,
  validateOwnedRuntimeRun,
} from "./owned-run";
export type {
  RuntimeRunManifest,
  ValidatedWindowsRuntimeRun,
  ValidateOwnedRuntimeRunInput,
} from "./owned-run";
export { NodeWindowsRuntimePlatformProbe } from "./node-windows-platform-probe";
export type { NodeWindowsPlatformProbeOptions } from "./node-windows-platform-probe";
export {
  cleanupStoppedFormalRun,
  cleanupWindowsRuntime,
  createWindowsRuntimeRun,
  WindowsRuntimeRunHandle,
} from "./run-lifecycle";
export type { RuntimeCleanupReport, RuntimeLifecycleOptions } from "./run-lifecycle";
export type {
  CleanupTargetValidationInput,
  RuntimeOwnershipMarker,
  ValidatedCleanupTarget,
} from "./cleanup-policy";
