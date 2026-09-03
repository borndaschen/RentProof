import { win32 } from "node:path";
import { z } from "zod";
import { RuntimeOwnershipMarkerSchema, type RuntimeOwnershipMarker } from "./cleanup-policy";
import { WindowsRuntimePolicyError } from "./errors";
import type { WindowsRuntimePlatformProbe } from "./platform-probe";
import {
  assertAbsoluteLocalWindowsPath,
  assertNoRuntimeBoundaryOverlap,
  type RuntimePathBoundaries,
} from "./path-policy";

export const RUNTIME_RUN_MANIFEST_FILENAME = ".rentproof-runtime-run.json";

export const RuntimeRunManifestSchema = z
  .object({
    schema: z.literal("rentproof.runtime-run.v1"),
    ownerId: z.string().uuid(),
    runKind: z.enum(["development", "formal_demo"]),
    createdAt: z.iso.datetime({ offset: true }),
    lastWrittenAt: z.iso.datetime({ offset: true }),
    status: z.enum(["active", "stopped"]),
    processId: z.number().int().positive(),
    instanceId: z.string().uuid(),
  })
  .strict();

export type RuntimeRunManifest = z.infer<typeof RuntimeRunManifestSchema>;

const validatedRunBrand: unique symbol = Symbol("validatedWindowsRuntimeRun");

export interface ValidatedWindowsRuntimeRun {
  readonly runtimeRoot: string;
  readonly runPath: string;
  readonly statePath: string;
  readonly marker: RuntimeOwnershipMarker;
  readonly manifest: RuntimeRunManifest;
  readonly [validatedRunBrand]: true;
}

export interface ValidateOwnedRuntimeRunInput extends RuntimePathBoundaries {
  runtimeRoot: string;
  runPath: string;
  marker: unknown;
  manifest: unknown;
  expectedOwnerId: string;
}

function isDirectChild(root: string, child: string): boolean {
  return win32.dirname(child).toLowerCase() === root.toLowerCase() && child !== root;
}

function samePath(left: string, right: string): boolean {
  return (
    win32
      .normalize(left)
      .replace(/[\\/]+$/u, "")
      .toLowerCase() ===
    win32
      .normalize(right)
      .replace(/[\\/]+$/u, "")
      .toLowerCase()
  );
}

export async function validateOwnedRuntimeRun(
  input: ValidateOwnedRuntimeRunInput,
  probe: WindowsRuntimePlatformProbe,
): Promise<ValidatedWindowsRuntimeRun> {
  const marker = RuntimeOwnershipMarkerSchema.safeParse(input.marker);
  if (!marker.success) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_MARKER_INVALID");
  }
  const manifest = RuntimeRunManifestSchema.safeParse(input.manifest);
  if (!manifest.success) {
    throw new WindowsRuntimePolicyError("RUNTIME_RUN_MANIFEST_INVALID");
  }

  const lexicalRoot = assertAbsoluteLocalWindowsPath(input.runtimeRoot);
  const lexicalRun = assertAbsoluteLocalWindowsPath(input.runPath);
  assertNoRuntimeBoundaryOverlap(lexicalRoot, input);
  if (!isDirectChild(lexicalRoot, lexicalRun)) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_TARGET_INVALID");
  }

  const [rootInspection, runInspection] = await Promise.all([
    probe.inspectPath(lexicalRoot),
    probe.inspectPath(lexicalRun),
  ]);
  const resolvedRoot = assertAbsoluteLocalWindowsPath(rootInspection.resolvedPath);
  const resolvedRun = assertAbsoluteLocalWindowsPath(runInspection.resolvedPath);
  assertNoRuntimeBoundaryOverlap(resolvedRoot, input);
  if (rootInspection.volumeKind !== "fixed" || runInspection.volumeKind !== "fixed") {
    throw new WindowsRuntimePolicyError("RUNTIME_VOLUME_NOT_FIXED");
  }
  if (rootInspection.hasReparsePointInPath || runInspection.hasReparsePointInPath) {
    throw new WindowsRuntimePolicyError("RUNTIME_REPARSE_POINT_DISALLOWED");
  }
  if (!isDirectChild(resolvedRoot, resolvedRun)) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_TARGET_INVALID");
  }

  const markerRoot = assertAbsoluteLocalWindowsPath(marker.data.runtimeRoot);
  if (
    marker.data.ownerId !== input.expectedOwnerId ||
    manifest.data.ownerId !== input.expectedOwnerId ||
    marker.data.ownerId !== manifest.data.ownerId ||
    marker.data.runKind !== manifest.data.runKind ||
    marker.data.targetName.toLowerCase() !== win32.basename(resolvedRun).toLowerCase() ||
    !samePath(markerRoot, resolvedRoot)
  ) {
    throw new WindowsRuntimePolicyError("RUNTIME_CLEANUP_MARKER_MISMATCH");
  }

  return {
    runtimeRoot: resolvedRoot,
    runPath: resolvedRun,
    statePath: win32.join(resolvedRun, "state"),
    marker: marker.data,
    manifest: manifest.data,
    [validatedRunBrand]: true,
  };
}
