import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowsRuntimePlatformProbe } from "../windows-runtime/platform-probe";
import { validateOwnedRuntimeRun } from "../windows-runtime/owned-run";
import { WindowsJsonStateFilesystem } from "./windows-json-state-filesystem";

const ownerId = "24c90f68-c770-4db6-b341-87f7318f6289";
const createdAt = "2026-09-03T00:00:00.000Z";
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    expect(root.toLowerCase()).toContain(join(tmpdir(), "rentproof-json-").toLowerCase());
    await rm(root, { recursive: true, force: true });
  }
});

async function setup() {
  const parent = await mkdtemp(join(tmpdir(), "rentproof-json-"));
  temporaryRoots.push(parent);
  const runtimeRoot = win32.join(parent, "runtime");
  const runPath = win32.join(runtimeRoot, "development-owned-run");
  await mkdir(win32.join(runPath, "state"), { recursive: true });
  const marker = {
    schema: "rentproof.runtime-owner.v1" as const,
    ownerId,
    runtimeRoot,
    targetName: "development-owned-run",
    runKind: "development" as const,
    createdAt,
  };
  const manifest = {
    schema: "rentproof.runtime-run.v1" as const,
    ownerId,
    runKind: "development" as const,
    createdAt,
    lastWrittenAt: createdAt,
    status: "active" as const,
    processId: 1234,
    instanceId: "ad56083a-70eb-4c07-a52a-288575d25689",
  };
  const probe: WindowsRuntimePlatformProbe = {
    inspectPath: async (path) => ({
      resolvedPath: win32.normalize(path),
      volumeKind: "fixed",
      hasReparsePointInPath: false,
    }),
  };
  const run = await validateOwnedRuntimeRun(
    {
      runtimeRoot,
      runPath,
      marker,
      manifest,
      expectedOwnerId: ownerId,
      repositoryRoot: "C:\\workspace\\RentProof",
      demoRoot: "C:\\Users\\Demo\\RentProof-Demo",
      publicRoot: "C:\\workspace\\RentProof\\public",
      userProfile: "C:\\Users\\Demo",
    },
    probe,
  );
  return { filesystem: new WindowsJsonStateFilesystem({ run, probe }), runPath };
}

describe("WindowsJsonStateFilesystem", () => {
  it("performs atomic expected-text writes and leaves no temporary files", async () => {
    const { filesystem, runPath } = await setup();
    const key = "cases/case_abcdefghijklmnopqrstu.json";

    await expect(filesystem.writeTextIfUnchanged(key, null, '{"revision":0}')).resolves.toBe(true);
    await expect(filesystem.writeTextIfUnchanged(key, null, '{"revision":1}')).resolves.toBe(false);
    await expect(
      filesystem.writeTextIfUnchanged(key, '{"revision":0}', '{"revision":1}'),
    ).resolves.toBe(true);
    await expect(filesystem.readText(key)).resolves.toBe('{"revision":1}');

    const names = await readdir(win32.join(runPath, "state", "cases"));
    expect(names).toEqual(["case_abcdefghijklmnopqrstu.json"]);
    const [name] = names;
    if (name === undefined) throw new Error("expected persisted case file");
    expect(await readFile(win32.join(runPath, "state", "cases", name), "utf8")).toBe(
      '{"revision":1}',
    );
  });

  it("serializes concurrent compare-and-swap writes with a per-case lock", async () => {
    const { filesystem } = await setup();
    const key = "cases/case_abcdefghijklmnopqrstu.json";
    await filesystem.writeTextIfUnchanged(key, null, "base");

    const results = await Promise.all([
      filesystem.writeTextIfUnchanged(key, "base", "first"),
      filesystem.writeTextIfUnchanged(key, "base", "second"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(filesystem.readText(key)).resolves.toMatch(/^(?:first|second)$/u);
  });

  it("rejects traversal, unrelated keys, and oversized state before disk access", async () => {
    const { filesystem } = await setup();
    await expect(filesystem.readText("../outside.json")).rejects.toMatchObject({
      code: "RUNTIME_STORAGE_KEY_INVALID",
    });
    await expect(filesystem.readText("artifacts/item.json")).rejects.toMatchObject({
      code: "RUNTIME_STORAGE_KEY_INVALID",
    });
    await expect(
      filesystem.writeTextIfUnchanged(
        "cases/case_abcdefghijklmnopqrstu.json",
        null,
        "x".repeat(16 * 1024 * 1024 + 1),
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_STATE_TOO_LARGE" });
  });
});
