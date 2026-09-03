import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeWindowsRuntimePlatformProbe } from "./node-windows-platform-probe";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    expect(root.toLowerCase()).toContain(join(tmpdir(), "rentproof-probe-").toLowerCase());
    await rm(root, { recursive: true, force: true });
  }
});

describe("NodeWindowsRuntimePlatformProbe", () => {
  it("rejects non-Windows composition without touching the filesystem", async () => {
    const probe = new NodeWindowsRuntimePlatformProbe({ platform: "linux" });
    await expect(probe.inspectPath("C:\\runtime")).rejects.toMatchObject({
      code: "RUNTIME_PLATFORM_UNSUPPORTED",
    });
  });

  it("resolves a missing descendant from an existing ancestor and probes its fixed drive", async () => {
    const root = await mkdtemp(join(tmpdir(), "rentproof-probe-"));
    roots.push(root);
    const volume = vi.fn(async () => "fixed" as const);
    const reparse = vi.fn(async () => false);
    const probe = new NodeWindowsRuntimePlatformProbe({
      platform: "win32",
      resolveVolumeKind: volume,
      inspectReparsePoint: reparse,
    });

    await expect(probe.inspectPath(win32.join(root, "missing", "runtime"))).resolves.toMatchObject({
      volumeKind: "fixed",
      hasReparsePointInPath: false,
    });
    expect(volume).toHaveBeenCalledWith(win32.parse(root).root);
    expect(reparse).toHaveBeenCalled();
  });

  it("fails closed when an existing ancestor is reported as a reparse point", async () => {
    const root = await mkdtemp(join(tmpdir(), "rentproof-probe-"));
    roots.push(root);
    const probe = new NodeWindowsRuntimePlatformProbe({
      platform: "win32",
      resolveVolumeKind: async () => "fixed",
      inspectReparsePoint: async (path) => path.toLowerCase() === root.toLowerCase(),
    });
    await expect(probe.inspectPath(win32.join(root, "runtime"))).resolves.toMatchObject({
      hasReparsePointInPath: true,
    });
  });
});
