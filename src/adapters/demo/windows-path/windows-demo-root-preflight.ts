import { win32 } from "node:path";
import { WindowsDemoPathError } from "./errors";
import type { WindowsPathInspection, WindowsPathProbe } from "./ports";

const CASE_VERSION_PATTERN = /^golden-v[1-9][0-9]*$/u;
const LOCAL_DRIVE_ABSOLUTE_PATTERN = /^[a-z]:[\\/]/iu;
const UNSAFE_PATH_CHARACTER = /[\u0000-\u001f]/u;

export type WindowsDemoRootPreflightOptions = {
  repositoryRoot: string;
  runtimeRoot: string;
  publicRoot: string;
  additionalSyncRoots?: readonly string[];
};

export type WindowsDemoRootPreflightInput = {
  explicitDemoDir?: string | null;
  caseVersion: string;
};

export type VerifiedWindowsDemoPaths = {
  demoRoot: string;
  casesRoot: string;
  caseRoot: string;
  caseVersion: string;
};

export class WindowsDemoRootPreflight {
  readonly #probe: WindowsPathProbe;
  readonly #options: WindowsDemoRootPreflightOptions;

  constructor(probe: WindowsPathProbe, options: WindowsDemoRootPreflightOptions) {
    this.#probe = probe;
    this.#options = options;
  }

  async verify(input: WindowsDemoRootPreflightInput): Promise<VerifiedWindowsDemoPaths> {
    if (this.#probe.platform !== "win32") {
      throw new WindowsDemoPathError("DEMO_DIR_UNSAFE");
    }
    if (!CASE_VERSION_PATTERN.test(input.caseVersion)) {
      throw new WindowsDemoPathError("DEMO_CASE_VERSION_INVALID");
    }

    const userProfile = this.#probe.getEnvironmentVariable("USERPROFILE");
    const requestedRoot =
      input.explicitDemoDir === undefined ||
      input.explicitDemoDir === null ||
      input.explicitDemoDir.length === 0
        ? userProfile === undefined
          ? null
          : win32.join(userProfile, "RentProof-Demo")
        : input.explicitDemoDir;
    if (requestedRoot === null) {
      throw new WindowsDemoPathError("DEMO_DIR_MISSING");
    }
    const normalizedRequestedRoot = normalizeLocalAbsolutePath(requestedRoot, "DEMO_DIR_UNSAFE");
    const rootInspection = await this.#safeInspect(normalizedRequestedRoot, "DEMO_DIR_UNSAFE");
    if (!rootInspection.exists || rootInspection.kind === "missing") {
      throw new WindowsDemoPathError("DEMO_DIR_MISSING");
    }
    const demoRoot = validateSafeDirectory(
      rootInspection,
      normalizedRequestedRoot,
      "DEMO_DIR_UNSAFE",
    );

    const protectedRoots = await this.#protectedRoots(userProfile);
    if (protectedRoots.some((protectedRoot) => pathsOverlap(demoRoot, protectedRoot))) {
      throw new WindowsDemoPathError("DEMO_DIR_UNSAFE");
    }

    const casesRequested = win32.join(demoRoot, "cases");
    const casesInspection = await this.#safeInspect(casesRequested, "DEMO_CASE_DIR_UNSAFE");
    if (!casesInspection.exists || casesInspection.kind === "missing") {
      throw new WindowsDemoPathError("DEMO_CASE_DIR_MISSING");
    }
    const casesRoot = validateSafeDirectory(
      casesInspection,
      casesRequested,
      "DEMO_CASE_DIR_UNSAFE",
    );
    ensureSameVolumeAndContained(demoRoot, rootInspection, casesRoot, casesInspection);

    const caseRequested = win32.join(casesRoot, input.caseVersion);
    const caseInspection = await this.#safeInspect(caseRequested, "DEMO_CASE_DIR_UNSAFE");
    if (!caseInspection.exists || caseInspection.kind === "missing") {
      throw new WindowsDemoPathError("DEMO_CASE_DIR_MISSING");
    }
    const caseRoot = validateSafeDirectory(caseInspection, caseRequested, "DEMO_CASE_DIR_UNSAFE");
    ensureSameVolumeAndContained(casesRoot, casesInspection, caseRoot, caseInspection);
    ensureContained(demoRoot, caseRoot, "DEMO_CASE_DIR_UNSAFE");

    return { demoRoot, casesRoot, caseRoot, caseVersion: input.caseVersion };
  }

  async #protectedRoots(userProfile: string | undefined): Promise<string[]> {
    const configured = [
      this.#options.repositoryRoot,
      this.#options.runtimeRoot,
      this.#options.publicRoot,
      ...(this.#options.additionalSyncRoots ?? []),
    ];
    if (userProfile !== undefined) {
      configured.push(win32.join(userProfile, "Documents"));
    }
    for (const name of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
      const value = this.#probe.getEnvironmentVariable(name);
      if (value !== undefined && value.length > 0) {
        configured.push(value);
      }
    }

    const roots: string[] = [];
    for (const root of configured) {
      const normalized = normalizeLocalAbsolutePath(root, "DEMO_DIR_UNSAFE");
      const inspection = await this.#safeInspect(normalized, "DEMO_DIR_UNSAFE");
      roots.push(
        inspection.exists && inspection.realPath !== null
          ? normalizeLocalAbsolutePath(inspection.realPath, "DEMO_DIR_UNSAFE")
          : normalized,
      );
    }
    return roots;
  }

  async #safeInspect(
    path: string,
    unsafeCode: "DEMO_DIR_UNSAFE" | "DEMO_CASE_DIR_UNSAFE",
  ): Promise<WindowsPathInspection> {
    try {
      return await this.#probe.inspect(path);
    } catch {
      throw new WindowsDemoPathError(unsafeCode);
    }
  }
}

function validateSafeDirectory(
  inspection: WindowsPathInspection,
  requestedPath: string,
  unsafeCode: "DEMO_DIR_UNSAFE" | "DEMO_CASE_DIR_UNSAFE",
): string {
  if (
    inspection.kind !== "directory" ||
    inspection.realPath === null ||
    inspection.volumeRoot === null ||
    inspection.driveType !== "fixed" ||
    inspection.fileSystem?.toUpperCase() !== "NTFS" ||
    inspection.reparsePoint ||
    inspection.symbolicLink ||
    inspection.junction ||
    inspection.syncRoot
  ) {
    throw new WindowsDemoPathError(unsafeCode);
  }
  const realPath = normalizeLocalAbsolutePath(inspection.realPath, unsafeCode);
  const requestedVolume = win32.parse(requestedPath).root;
  const realVolume = win32.parse(realPath).root;
  if (
    !samePath(requestedVolume, realVolume) ||
    !samePath(realVolume, normalizeLocalAbsolutePath(inspection.volumeRoot, unsafeCode))
  ) {
    throw new WindowsDemoPathError(unsafeCode);
  }
  return realPath;
}

function ensureSameVolumeAndContained(
  parent: string,
  parentInspection: WindowsPathInspection,
  child: string,
  childInspection: WindowsPathInspection,
): void {
  if (
    parentInspection.volumeRoot === null ||
    childInspection.volumeRoot === null ||
    !samePath(parentInspection.volumeRoot, childInspection.volumeRoot)
  ) {
    throw new WindowsDemoPathError("DEMO_CASE_DIR_UNSAFE");
  }
  ensureContained(parent, child, "DEMO_CASE_DIR_UNSAFE");
}

function ensureContained(
  parent: string,
  child: string,
  unsafeCode: "DEMO_DIR_UNSAFE" | "DEMO_CASE_DIR_UNSAFE",
): void {
  const relative = win32.relative(parent, child);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${win32.sep}`) ||
    win32.isAbsolute(relative)
  ) {
    throw new WindowsDemoPathError(unsafeCode);
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return samePath(left, right) || isContained(left, right) || isContained(right, left);
}

function isContained(parent: string, child: string): boolean {
  const relative = win32.relative(parent, child);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${win32.sep}`) &&
    !win32.isAbsolute(relative)
  );
}

function samePath(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

function normalizeForComparison(path: string): string {
  return win32
    .normalize(path)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();
}

function normalizeLocalAbsolutePath(
  path: string,
  unsafeCode: "DEMO_DIR_UNSAFE" | "DEMO_CASE_DIR_UNSAFE",
): string {
  if (
    path.length === 0 ||
    path !== path.trim() ||
    UNSAFE_PATH_CHARACTER.test(path) ||
    !LOCAL_DRIVE_ABSOLUTE_PATTERN.test(path) ||
    !win32.isAbsolute(path) ||
    path.startsWith("\\\\") ||
    path.startsWith("//")
  ) {
    throw new WindowsDemoPathError(unsafeCode);
  }
  const normalized = win32.normalize(path);
  if (normalized.slice(2).includes(":")) {
    throw new WindowsDemoPathError(unsafeCode);
  }
  return normalized;
}
