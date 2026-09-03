import { win32 } from "node:path";
import { z } from "zod";
import { WindowsRuntimePolicyError } from "./errors";
import type { WindowsRuntimePlatformProbe } from "./platform-probe";
import {
  assertAbsoluteLocalWindowsPath,
  assertNoRuntimeBoundaryOverlap,
  type RuntimePathBoundaries,
} from "./path-policy";

export const RUNTIME_OWNERSHIP_MARKER_FILENAME = ".rentproof-runtime-owner.json";

export const RuntimeOwnershipMarkerSchema = z
  .object({
    schema: z.literal("rentproof.runtime-owner.v1"),
    ownerId: z.string().uuid(),
    runtimeRoot: z.string().min(1),
    targetName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/u),
    runKind: z.enum(["development", "formal_demo"]),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type RuntimeOwnershipMarker = z.infer<typeof RuntimeOwnershipMarkerSchema>;

function comparisonPath(path: string): string {
  return win32
    .normalize(path)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();
}

function isDirectChild(root: string, target: string): boolean {
  return win32.dirname(target).toLowerCase() === root.toLowerCase() && target !== root;
}

export interface CleanupTargetValidationInput extends RuntimePathBoundaries {
  runtimeRoot: string;
  targetPath: string;
  marker: unknown;
  expectedOwnerId: string;
  cleanupLockAcquired: boolean;
  runActive: boolean;
}

export interface ValidatedCleanupTarget {
  runtimeRoot: string;
  targetPath: string;
  marker: RuntimeOwnershipMarker;
}

/** Validates a possible cleanup target. It never deletes, creates, locks, or writes anything. */
export async function validateCleanupTarget(
  input: CleanupTargetValidationInput,
  probe: WindowsRuntimePlatformProbe,
): Promise<ValidatedCleanupTarget> {
  if (!input.cleanupLockAcquired) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_LOCK_REQUIRED");
  }
  if (input.runActive) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_TARGET_ACTIVE");
  }

  const parsedMarker = RuntimeOwnershipMarkerSchema.safeParse(input.marker);
  if (!parsedMarker.success) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_MARKER_INVALID");
  }

  const lexicalRoot = assertAbsoluteLocalWindowsPath(input.runtimeRoot);
  const lexicalTarget = assertAbsoluteLocalWindowsPath(input.targetPath);
  assertNoRuntimeBoundaryOverlap(lexicalRoot, input);
  if (!isDirectChild(lexicalRoot, lexicalTarget)) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_TARGET_INVALID");
  }

  const [rootInspection, targetInspection] = await Promise.all([
    probe.inspectPath(lexicalRoot),
    probe.inspectPath(lexicalTarget),
  ]);
  const resolvedRoot = assertAbsoluteLocalWindowsPath(rootInspection.resolvedPath);
  const resolvedTarget = assertAbsoluteLocalWindowsPath(targetInspection.resolvedPath);
  assertNoRuntimeBoundaryOverlap(resolvedRoot, input);

  if (
    rootInspection.volumeKind !== "fixed" ||
    targetInspection.volumeKind !== "fixed" ||
    rootInspection.hasReparsePointInPath ||
    targetInspection.hasReparsePointInPath
  ) {
    throw new WindowsRuntimePolicyError(
      rootInspection.hasReparsePointInPath || targetInspection.hasReparsePointInPath
        ? "RUNTIME_REPARSE_POINT_DISALLOWED"
        : "RUNTIME_VOLUME_NOT_FIXED",
    );
  }
  if (!isDirectChild(resolvedRoot, resolvedTarget)) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_TARGET_INVALID");
  }

  const markerRoot = assertAbsoluteLocalWindowsPath(parsedMarker.data.runtimeRoot);
  if (
    parsedMarker.data.ownerId !== input.expectedOwnerId ||
    comparisonPath(markerRoot) !== comparisonPath(resolvedRoot) ||
    parsedMarker.data.targetName.toLowerCase() !== win32.basename(resolvedTarget).toLowerCase()
  ) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_MARKER_MISMATCH");
  }

  return { runtimeRoot: resolvedRoot, targetPath: resolvedTarget, marker: parsedMarker.data };
}
