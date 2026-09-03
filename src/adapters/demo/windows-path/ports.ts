export type WindowsDriveType = "fixed" | "removable" | "network" | "unknown";

export type WindowsPathInspection = {
  exists: boolean;
  kind: "directory" | "file" | "other" | "missing";
  realPath: string | null;
  volumeRoot: string | null;
  driveType: WindowsDriveType;
  fileSystem: string | null;
  reparsePoint: boolean;
  symbolicLink: boolean;
  junction: boolean;
  syncRoot: boolean;
};

export interface WindowsPathProbe {
  readonly platform: string;
  getEnvironmentVariable(name: string): string | undefined;
  inspect(path: string): Promise<WindowsPathInspection>;
}
