import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateOwnedRuntimeRun } from "../windows-runtime/owned-run";
import type { WindowsRuntimePlatformProbe } from "../windows-runtime/platform-probe";
import { WindowsJsonJobQueueStateStore } from "./windows-json-job-queue-state-store";

const ownerId = "24c90f68-c770-4db6-b341-87f7318f6289";
const createdAt = "2026-09-04T00:00:00.000Z";
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    expect(root.toLowerCase()).toContain(join(tmpdir(), "rentproof-job-queue-").toLowerCase());
    await rm(root, { recursive: true, force: true });
  }
});

async function setup(overrides: Partial<WindowsRuntimePlatformProbe> = {}) {
  const parent = await mkdtemp(join(tmpdir(), "rentproof-job-queue-"));
  temporaryRoots.push(parent);
  const runtimeRoot = win32.join(parent, "runtime");
  const runPath = win32.join(runtimeRoot, "development-owned-run");
  await mkdir(win32.join(runPath, "state"), { recursive: true });
  const probe: WindowsRuntimePlatformProbe = {
    inspectPath:
      overrides.inspectPath ??
      (async (path) => ({
        resolvedPath: win32.normalize(path),
        volumeKind: "fixed",
        hasReparsePointInPath: false,
      })),
  };
  const run = await validateOwnedRuntimeRun(
    {
      runtimeRoot,
      runPath,
      marker: {
        schema: "rentproof.runtime-owner.v1",
        ownerId,
        runtimeRoot,
        targetName: "development-owned-run",
        runKind: "development",
        createdAt,
      },
      manifest: {
        schema: "rentproof.runtime-run.v1",
        ownerId,
        runKind: "development",
        createdAt,
        lastWrittenAt: createdAt,
        status: "active",
        processId: 1234,
        instanceId: "ad56083a-70eb-4c07-a52a-288575d25689",
      },
      expectedOwnerId: ownerId,
      repositoryRoot: "C:\\workspace\\RentProof",
      demoRoot: "C:\\Users\\Demo\\RentProof-Demo",
      publicRoot: "C:\\workspace\\RentProof\\public",
      userProfile: "C:\\Users\\Demo",
    },
    probe,
  );
  return { store: new WindowsJsonJobQueueStateStore({ run, probe }), runPath };
}

describe("WindowsJsonJobQueueStateStore", () => {
  it("atomically compares and replaces the single queue snapshot", async () => {
    const { store, runPath } = await setup();
    await expect(store.readText()).resolves.toBeNull();
    await expect(store.writeTextIfUnchanged(null, '{"revision":1}')).resolves.toBe(true);
    await expect(store.writeTextIfUnchanged(null, '{"revision":2}')).resolves.toBe(false);
    await expect(store.writeTextIfUnchanged('{"revision":1}', '{"revision":2}')).resolves.toBe(
      true,
    );
    await expect(store.readText()).resolves.toBe('{"revision":2}');
    await expect(readdir(win32.join(runPath, "state", "jobs"))).resolves.toEqual([
      "job-queue.json",
    ]);
  });

  it("serializes concurrent compare-and-swap writes", async () => {
    const { store } = await setup();
    await store.writeTextIfUnchanged(null, "base");
    const results = await Promise.all([
      store.writeTextIfUnchanged("base", "first"),
      store.writeTextIfUnchanged("base", "second"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(store.readText()).resolves.toMatch(/^(?:first|second)$/u);
  });

  it("fails closed for oversized snapshots and unsafe runtime paths", async () => {
    const { store } = await setup();
    await expect(
      store.writeTextIfUnchanged(null, "x".repeat(32 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ code: "RUNTIME_STATE_TOO_LARGE" });
    const { store: unsafe } = await setup({
      inspectPath: async (path) => ({
        resolvedPath: win32.normalize(path),
        volumeKind: "fixed",
        hasReparsePointInPath: path.endsWith("job-queue.json"),
      }),
    });
    await expect(unsafe.readText()).rejects.toMatchObject({
      code: "RUNTIME_REPARSE_POINT_DISALLOWED",
    });
  });
});
