import { createHash } from "node:crypto";
import type { StageConfiguration } from "./contracts";
import type { PipelineStageId } from "./dag";

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite canonical value.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Unsupported canonical value.");
}

export function createStageKey(
  input: Readonly<{
    caseId: string;
    executionMode: "fixture" | "live";
    stageId: PipelineStageId;
    directInputHash: string;
    dependencyOutputHashes: readonly string[];
    configuration: StageConfiguration;
  }>,
): Readonly<{ stageRunKey: string; dependencyHash: string; configHash: string }> {
  const dependencyHash = sha256Canonical([...input.dependencyOutputHashes].sort());
  const configHash = sha256Canonical({ stageId: input.stageId, ...input.configuration });
  const stageRunKey = sha256Canonical({
    caseId: input.caseId,
    executionMode: input.executionMode,
    stageScope: "full",
    stageId: input.stageId,
    directInputHash: input.directInputHash,
    dependencyHash,
    configHash,
  });
  return { stageRunKey, dependencyHash, configHash };
}
