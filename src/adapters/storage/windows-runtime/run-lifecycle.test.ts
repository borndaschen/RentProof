import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowsRuntimePlatformProbe } from "./platform-probe";
import {
  cleanupStoppedFormalRun,
  cleanupWindowsRuntime,
  createWindowsRuntimeRun,
  type RuntimeLifecycleOptions,
} from "./run-lifecycle";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    expect(root.toLowerCase()).toContain(join(tmpdir(), "rentproof-runtime-").toLowerCase());
    await rm(root, { recursive: true, force: true });
  }
});

async function setup(reparseFragment?: string) {
  const parent = await mkdtemp(join(tmpdir(), "rentproof-runtime-"));
  temporaryRoots.push(parent);
  const runtimeRoot = win32.join(parent, "runtime");
  const probe: WindowsRuntimePlatformProbe = {
    inspectPath: async (path) => ({
      resolvedPath: win32.normalize(path),
      volumeKind: "fixed",
      hasReparsePointInPath:
        reparseFragment !== undefined && path.toLowerCase().includes(reparseFragment.toLowerCase()),
    }),
  };
  const base: RuntimeLifecycleOptions = {
    runtime: { path: runtimeRoot, source: "explicit" },
    probe,
    repositoryRoot: "C:\\workspace\\RentProof",
    demoRoot: "C:\\Users\\Demo\\RentProof-Demo",
    publicRoot: "C:\\workspace\\RentProof\\public",
    userProfile: "C:\\Users\\Demo",
    processId: 4242,
    isProcessAlive: () => false,
  };
  return { base, runtimeRoot };
}

describe("Windows runtime lifecycle", () => {
  it("creates an owned development child and expires it seven days after the last write", async () => {
    const { base, runtimeRoot } = await setup();
    const created = new Date("2026-09-01T00:00:00.000Z");
    const handle = await createWindowsRuntimeRun({ ...base, now: () => created }, "development");
    expect(handle.run.runPath).not.toBe(runtimeRoot);
    expect(win32.dirname(handle.run.runPath).toLowerCase()).toBe(runtimeRoot.toLowerCase());
    await expect(
      readFile(win32.join(handle.run.runPath, ".rentproof-runtime-owner.json"), "utf8"),
    ).resolves.toContain("rentproof.runtime-owner.v1");

    await handle.stop();
    const beforeExpiry = await cleanupWindowsRuntime(
      { ...base, now: () => new Date("2026-09-07T23:59:59.999Z") },
      "development_expired_and_abandoned_formal",
    );
    expect(beforeExpiry.deletedRunNames).toEqual([]);
    const expired = await cleanupWindowsRuntime(
      { ...base, now: () => new Date("2026-09-08T00:00:00.000Z") },
      "development_expired_and_abandoned_formal",
    );
    expect(expired.deletedRunNames).toEqual([win32.basename(handle.run.runPath)]);
    await expect(
      readFile(win32.join(runtimeRoot, ".rentproof-runtime-root.json")),
    ).resolves.toBeDefined();
  });

  it("deletes a stopped formal Demo run immediately while preserving the runtime root", async () => {
    const { base, runtimeRoot } = await setup();
    const handle = await createWindowsRuntimeRun(base, "formal_demo");
    await cleanupStoppedFormalRun(base, handle);
    await expect(
      readFile(win32.join(runtimeRoot, ".rentproof-runtime-root.json")),
    ).resolves.toBeDefined();
    await expect(
      readFile(win32.join(handle.run.runPath, ".rentproof-runtime-run.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans an abandoned formal run on the next preflight but never an active run", async () => {
    const { base } = await setup();
    const abandoned = await createWindowsRuntimeRun(base, "formal_demo");
    const report = await cleanupWindowsRuntime(base, "abandoned_formal_only");
    expect(report.deletedRunNames).toEqual([win32.basename(abandoned.run.runPath)]);

    const active = await createWindowsRuntimeRun(
      { ...base, isProcessAlive: (processId) => processId === 4242 },
      "formal_demo",
    );
    const activeReport = await cleanupWindowsRuntime(
      { ...base, isProcessAlive: () => true },
      "abandoned_formal_only",
    );
    expect(activeReport.deletedRunNames).toEqual([]);
    await expect(
      readFile(win32.join(active.run.runPath, ".rentproof-runtime-run.json")),
    ).resolves.toBeDefined();
  });

  it("fails closed before deleting any bytes when a descendant is a reparse point", async () => {
    const { base } = await setup("escape-node");
    const handle = await createWindowsRuntimeRun(base, "formal_demo");
    await handle.stop();
    const escape = win32.join(handle.run.runPath, "state", "escape-node");
    await mkdir(escape);
    await writeFile(win32.join(escape, "do-not-follow.txt"), "outside target remains");

    const report = await cleanupWindowsRuntime(base, "abandoned_formal_only");
    expect(report.deletedRunNames).toEqual([]);
    expect(report.skipped).toEqual([
      {
        runName: win32.basename(handle.run.runPath),
        reasonCode: "RUNTIME_CLEANUP_REPARSE_DESCENDANT",
      },
    ]);
    await expect(
      readFile(win32.join(handle.run.runPath, ".rentproof-runtime-run.json")),
    ).resolves.toBeDefined();
    await expect(readFile(win32.join(escape, "do-not-follow.txt"), "utf8")).resolves.toBe(
      "outside target remains",
    );
  });

  it("does not delete unowned or malformed children", async () => {
    const { base, runtimeRoot } = await setup();
    await createWindowsRuntimeRun(base, "development");
    const foreign = win32.join(runtimeRoot, "foreign-child");
    await mkdir(foreign);
    await writeFile(win32.join(foreign, "keep.txt"), "keep");

    const report = await cleanupWindowsRuntime(base, "development_expired_and_abandoned_formal");
    expect(report.skipped).toContainEqual({
      runName: "foreign-child",
      reasonCode: "RUNTIME_IO_FAILED",
    });
    await expect(readFile(win32.join(foreign, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("refuses cleanup when the root lock is already held", async () => {
    const { base, runtimeRoot } = await setup();
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(win32.join(runtimeRoot, ".rentproof-cleanup.lock"), "other process");
    await expect(cleanupWindowsRuntime(base, "abandoned_formal_only")).rejects.toMatchObject({
      code: "RUNTIME_CLEANUP_LOCK_BUSY",
    });
  });
});
