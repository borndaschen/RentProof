import { createHash } from "node:crypto";
import { MaterialCandidatePayloadSchema } from "@/domain/conversation";
import type { MaterialCandidatePayload } from "@/domain/conversation";

function toCanonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers.");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => toCanonicalJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const properties = Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${toCanonicalJson(objectValue[key])}`);
    return `{${properties.join(",")}}`;
  }

  throw new TypeError("Canonical JSON only supports validated JSON values.");
}

export type CanonicalCandidatePayload = Readonly<{
  payload: MaterialCandidatePayload;
  canonicalJson: string;
  sha256: string;
}>;

export function canonicalizeCandidatePayload(input: unknown): CanonicalCandidatePayload {
  const payload = MaterialCandidatePayloadSchema.parse(input);
  const canonicalJson = toCanonicalJson(payload);
  const sha256 = createHash("sha256").update(canonicalJson, "utf8").digest("hex");

  return { payload, canonicalJson, sha256 };
}

export function hashOpaqueConfirmationId(confirmationId: string): string {
  return createHash("sha256").update(confirmationId, "utf8").digest("hex");
}
