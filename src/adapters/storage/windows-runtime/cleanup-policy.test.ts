import { describe, expect, it } from "vitest";
import type { WindowsPathInspection, WindowsRuntimePlatformProbe } from "./platform-probe";
import {
  validateCleanupTarget,
  type CleanupTargetValidationInput,
  type RuntimeOwnershipMarker,
} from "./cleanup-policy";
import { WindowsRuntimePolicyError } from "./errors";

const ownerId = "1ffb868a-24c5-4e17-b892-0fe3f212d62f";
const runtimeRoot = "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime";
const targetPath = `${runtimeRoot}\\formal-demo-8d28`;
const validMarker: RuntimeOwnershipMarker = {
  schema: "rentproof.runtime-owner.v1",
  ownerId,
  runtimeRoot,
  targetName: "formal-demo-8d28",
  runKind: "formal_demo",
  createdAt: "2026-09-02T10:00:00Z",
};

function baseInput(): CleanupTargetValidationInput {
  return {
    runtimeRoot,
    targetPath,
    expectedOwnerId: ownerId,
    cleanupLockAcquired: true,
    runActive: false,
    marker: validMarker,
    repositoryRoot: "C:\\Work\\RentProof",
    demoRoot: "C:\\Users\\Demo\\RentProof-Demo",
    publicRoot: "C:\\Work\\RentProof\\public",
    userProfile: "C:\\Users\\Demo",
  };
}

function probeWith(
  override: (path: string) => Partial<WindowsPathInspection> = () => ({}),
): WindowsRuntimePlatformProbe {
  return {
    inspectPath: async (path) => ({
      resolvedPath: path,
      volumeKind: "fixed",
      hasReparsePointInPath: false,
      ...override(path),
    }),
  };
}

async function expectCode(
  input: CleanupTargetValidationInput,
  code: WindowsRuntimePolicyError["code"],
  probe = probeWith(),
): Promise<void> {
  await expect(validateCleanupTarget(input, probe)).rejects.toMatchObject({ code });
}

describe("validateCleanupTarget", () => {
  it("authorizes only a fixed, direct, inactive, app-owned child without deleting it", async () => {
    await expect(validateCleanupTarget(baseInput(), probeWith())).resolves.toMatchObject({
      runtimeRoot,
      targetPath,
      marker: { ownerId, targetName: "formal-demo-8d28" },
    });
  });

  it("rejects runtime root, nested descendants, missing cleanup lock, active targets, and malformed markers", async () => {
    await expectCode({ ...baseInput(), targetPath: runtimeRoot }, "RUNTIME_CLEANUP_TARGET_INVALID");
    await expectCode(
      { ...baseInput(), targetPath: `${targetPath}\\nested` },
      "RUNTIME_CLEANUP_TARGET_INVALID",
    );
    await expectCode(
      { ...baseInput(), cleanupLockAcquired: false },
      "RUNTIME_CLEANUP_LOCK_REQUIRED",
    );
    await expectCode({ ...baseInput(), runActive: true }, "RUNTIME_CLEANUP_TARGET_ACTIVE");
    await expectCode(
      { ...baseInput(), marker: { schema: "wrong" } },
      "RUNTIME_CLEANUP_MARKER_INVALID",
    );
  });

  it("rejects owner, root, and target-name marker mismatches", async () => {
    await expectCode(
      {
        ...baseInput(),
        marker: { ...validMarker, ownerId: "b055146a-748d-44dc-bf12-b6a3fb4f84f8" },
      },
      "RUNTIME_CLEANUP_MARKER_MISMATCH",
    );
    await expectCode(
      { ...baseInput(), marker: { ...validMarker, runtimeRoot: "C:\\Other\\runtime" } },
      "RUNTIME_CLEANUP_MARKER_MISMATCH",
    );
    await expectCode(
      { ...baseInput(), marker: { ...validMarker, targetName: "different-run" } },
      "RUNTIME_CLEANUP_MARKER_MISMATCH",
    );
  });

  it("revalidates real path, fixed volume, and reparse state immediately before cleanup", async () => {
    await expectCode(
      baseInput(),
      "RUNTIME_CLEANUP_TARGET_INVALID",
      probeWith((path) =>
        path === targetPath ? { resolvedPath: "C:\\Outside\\escaped-run" } : {},
      ),
    );
    await expectCode(
      baseInput(),
      "RUNTIME_VOLUME_NOT_FIXED",
      probeWith((path) => (path === targetPath ? { volumeKind: "removable" } : {})),
    );
    await expectCode(
      baseInput(),
      "RUNTIME_REPARSE_POINT_DISALLOWED",
      probeWith((path) => (path === targetPath ? { hasReparsePointInPath: true } : {})),
    );
  });
});
