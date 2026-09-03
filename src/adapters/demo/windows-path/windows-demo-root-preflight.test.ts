import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import type { WindowsPathInspection, WindowsPathProbe } from "./ports";
import { WindowsDemoRootPreflight } from "./windows-demo-root-preflight";

const userProfile = "C:\\Users\\DemoUser";
const defaultRoot = `${userProfile}\\RentProof-Demo`;
const casesRoot = `${defaultRoot}\\cases`;
const caseRoot = `${casesRoot}\\golden-v1`;
const options = {
  repositoryRoot: "C:\\Work\\RentProof",
  runtimeRoot: `${userProfile}\\AppData\\Local\\RentProof\\runtime`,
  publicRoot: "C:\\Work\\RentProof\\public",
};

function safeInspection(path: string, overrides: Partial<WindowsPathInspection> = {}) {
  return {
    exists: true,
    kind: "directory" as const,
    realPath: win32.normalize(path),
    volumeRoot: "C:\\",
    driveType: "fixed" as const,
    fileSystem: "NTFS",
    reparsePoint: false,
    symbolicLink: false,
    junction: false,
    syncRoot: false,
    ...overrides,
  };
}

function configuredProbe(root = defaultRoot, caseVersion = "golden-v1"): FakeWindowsPathProbe {
  const probe = new FakeWindowsPathProbe({ USERPROFILE: userProfile });
  probe.set(root, safeInspection(root));
  const cases = win32.join(root, "cases");
  probe.set(cases, safeInspection(cases));
  const selectedCase = win32.join(cases, caseVersion);
  probe.set(selectedCase, safeInspection(selectedCase));
  return probe;
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code });
}

describe("WindowsDemoRootPreflight", () => {
  it("uses %USERPROFILE%\\RentProof-Demo by default without creating or writing", async () => {
    const probe = configuredProbe();
    const result = await new WindowsDemoRootPreflight(probe, options).verify({
      caseVersion: "golden-v1",
    });

    expect(result).toEqual({
      demoRoot: defaultRoot,
      casesRoot,
      caseRoot,
      caseVersion: "golden-v1",
    });
    expect(probe.inspectedPaths).toContain(defaultRoot);
    expect(probe.inspectedPaths).toContain(caseRoot);
  });

  it("accepts an explicit absolute local fixed NTFS root", async () => {
    const explicit = "D:\\Synthetic\\RentProof-Demo";
    const probe = configuredProbe(explicit, "golden-v2");
    probe.set(explicit, safeInspection(explicit, { volumeRoot: "D:\\" }));
    probe.set(`${explicit}\\cases`, safeInspection(`${explicit}\\cases`, { volumeRoot: "D:\\" }));
    probe.set(
      `${explicit}\\cases\\golden-v2`,
      safeInspection(`${explicit}\\cases\\golden-v2`, { volumeRoot: "D:\\" }),
    );

    await expect(
      new WindowsDemoRootPreflight(probe, options).verify({
        explicitDemoDir: explicit,
        caseVersion: "golden-v2",
      }),
    ).resolves.toMatchObject({ demoRoot: explicit, caseVersion: "golden-v2" });
  });

  it("returns DEMO_DIR_MISSING when USERPROFILE or the directory is absent", async () => {
    const noProfile = new FakeWindowsPathProbe({});
    await expectCode(
      new WindowsDemoRootPreflight(noProfile, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_DIR_MISSING",
    );

    const missing = new FakeWindowsPathProbe({ USERPROFILE: userProfile });
    await expectCode(
      new WindowsDemoRootPreflight(missing, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_DIR_MISSING",
    );
  });

  it.each([
    "RentProof-Demo",
    "C:RentProof-Demo",
    "\\\\server\\share\\RentProof-Demo",
    "\\\\?\\C:\\RentProof-Demo",
    "//server/share/RentProof-Demo",
    " C:\\RentProof-Demo",
    "C:\\RentProof-Demo:stream",
  ])("rejects non-local or malformed explicit path %s", async (explicitDemoDir) => {
    await expectCode(
      new WindowsDemoRootPreflight(configuredProbe(), options).verify({
        explicitDemoDir,
        caseVersion: "golden-v1",
      }),
      "DEMO_DIR_UNSAFE",
    );
  });

  it.each([
    ["removable", { driveType: "removable" }],
    ["network", { driveType: "network" }],
    ["unknown drive", { driveType: "unknown" }],
    ["non-NTFS", { fileSystem: "exFAT" }],
    ["file", { kind: "file" }],
    ["no realpath", { realPath: null }],
    ["reparse", { reparsePoint: true }],
    ["symlink", { symbolicLink: true }],
    ["junction", { junction: true }],
    ["sync root", { syncRoot: true }],
  ] as const)("rejects an unsafe root: %s", async (_label, override) => {
    const probe = configuredProbe();
    probe.set(defaultRoot, safeInspection(defaultRoot, override));
    await expectCode(
      new WindowsDemoRootPreflight(probe, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_DIR_UNSAFE",
    );
  });

  it.each([
    ["repository", options.repositoryRoot],
    ["runtime", options.runtimeRoot],
    ["public", options.publicRoot],
    ["Documents", `${userProfile}\\Documents`],
  ])("rejects overlap with %s", async (_label, protectedRoot) => {
    const probe = configuredProbe(protectedRoot);
    await expectCode(
      new WindowsDemoRootPreflight(probe, options).verify({
        explicitDemoDir: protectedRoot,
        caseVersion: "golden-v1",
      }),
      "DEMO_DIR_UNSAFE",
    );
  });

  it("rejects OneDrive, configured sync roots, and roots containing protected paths", async () => {
    const oneDrive = `${userProfile}\\OneDrive`;
    const oneDriveProbe = configuredProbe(oneDrive);
    oneDriveProbe.env["OneDrive"] = oneDrive;
    await expectCode(
      new WindowsDemoRootPreflight(oneDriveProbe, options).verify({
        explicitDemoDir: oneDrive,
        caseVersion: "golden-v1",
      }),
      "DEMO_DIR_UNSAFE",
    );

    const syncRoot = "C:\\Sync";
    await expectCode(
      new WindowsDemoRootPreflight(configuredProbe(syncRoot), {
        ...options,
        additionalSyncRoots: [syncRoot],
      }).verify({ explicitDemoDir: syncRoot, caseVersion: "golden-v1" }),
      "DEMO_DIR_UNSAFE",
    );

    const containingRoot = "C:\\Work";
    await expectCode(
      new WindowsDemoRootPreflight(configuredProbe(containingRoot), options).verify({
        explicitDemoDir: containingRoot,
        caseVersion: "golden-v1",
      }),
      "DEMO_DIR_UNSAFE",
    );
  });

  it.each(["latest", "Golden-v1", "golden-v0", "golden-v01", "../golden-v1", " golden-v1"])(
    "rejects invalid case version %s before path probing",
    async (caseVersion) => {
      const probe = configuredProbe();
      await expectCode(
        new WindowsDemoRootPreflight(probe, options).verify({ caseVersion }),
        "DEMO_CASE_VERSION_INVALID",
      );
      expect(probe.inspectedPaths).toHaveLength(0);
    },
  );

  it("requires cases and selected case directories to exist", async () => {
    const noCases = configuredProbe();
    noCases.remove(casesRoot);
    await expectCode(
      new WindowsDemoRootPreflight(noCases, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_CASE_DIR_MISSING",
    );

    const noCase = configuredProbe();
    noCase.remove(caseRoot);
    await expectCode(
      new WindowsDemoRootPreflight(noCase, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_CASE_DIR_MISSING",
    );
  });

  it.each([
    ["cases junction", casesRoot, { junction: true }],
    ["case symlink", caseRoot, { symbolicLink: true }],
    ["case reparse", caseRoot, { reparsePoint: true }],
    ["case sync root", caseRoot, { syncRoot: true }],
  ] as const)("rejects %s", async (_label, path, override) => {
    const probe = configuredProbe();
    probe.set(path, safeInspection(path, override));
    await expectCode(
      new WindowsDemoRootPreflight(probe, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_CASE_DIR_UNSAFE",
    );
  });

  it("rejects case realpath escape and cross-volume resolution", async () => {
    const escaped = configuredProbe();
    escaped.set(caseRoot, safeInspection(caseRoot, { realPath: "C:\\Outside\\golden-v1" }));
    await expectCode(
      new WindowsDemoRootPreflight(escaped, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_CASE_DIR_UNSAFE",
    );

    const crossVolume = configuredProbe();
    crossVolume.set(
      caseRoot,
      safeInspection(caseRoot, { realPath: "D:\\Outside\\golden-v1", volumeRoot: "D:\\" }),
    );
    await expectCode(
      new WindowsDemoRootPreflight(crossVolume, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_CASE_DIR_UNSAFE",
    );
  });

  it("fails closed outside Windows and when the probe throws", async () => {
    const nonWindows = configuredProbe();
    nonWindows.platform = "linux";
    await expectCode(
      new WindowsDemoRootPreflight(nonWindows, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_DIR_UNSAFE",
    );

    const throwing = configuredProbe();
    throwing.throwFor = defaultRoot;
    await expectCode(
      new WindowsDemoRootPreflight(throwing, options).verify({ caseVersion: "golden-v1" }),
      "DEMO_DIR_UNSAFE",
    );
  });
});

class FakeWindowsPathProbe implements WindowsPathProbe {
  platform = "win32";
  readonly env: Record<string, string>;
  readonly inspectedPaths: string[] = [];
  throwFor: string | null = null;
  readonly #inspections = new Map<string, WindowsPathInspection>();

  constructor(env: Record<string, string>) {
    this.env = env;
  }

  getEnvironmentVariable(name: string): string | undefined {
    return this.env[name];
  }

  async inspect(path: string): Promise<WindowsPathInspection> {
    const normalized = win32.normalize(path);
    this.inspectedPaths.push(normalized);
    if (
      this.throwFor !== null &&
      normalized.toLowerCase() === win32.normalize(this.throwFor).toLowerCase()
    ) {
      throw new Error("probe failure");
    }
    return (
      this.#inspections.get(normalized.toLowerCase()) ?? {
        exists: false,
        kind: "missing",
        realPath: null,
        volumeRoot: null,
        driveType: "unknown",
        fileSystem: null,
        reparsePoint: false,
        symbolicLink: false,
        junction: false,
        syncRoot: false,
      }
    );
  }

  set(path: string, inspection: WindowsPathInspection): void {
    this.#inspections.set(win32.normalize(path).toLowerCase(), inspection);
  }

  remove(path: string): void {
    this.#inspections.delete(win32.normalize(path).toLowerCase());
  }
}
