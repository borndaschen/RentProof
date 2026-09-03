export type WindowsVolumeKind = "fixed" | "removable" | "network" | "unknown";

export interface WindowsPathInspection {
  /** Canonical path after resolving existing ancestors and the candidate path. */
  resolvedPath: string;
  volumeKind: WindowsVolumeKind;
  /** True if the candidate or any existing ancestor is a symlink, junction, or other reparse point. */
  hasReparsePointInPath: boolean;
}

/** Infrastructure port. Implementations may inspect Windows, but policy code never touches disk directly. */
export interface WindowsRuntimePlatformProbe {
  inspectPath(path: string): Promise<WindowsPathInspection>;
}
