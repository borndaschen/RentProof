import { createHash } from "node:crypto";
import { MaterialCandidatePayloadSchema } from "@/domain/conversation/candidate";
import type { MaterialCandidatePayload } from "@/domain/conversation/candidate";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("NON_FINITE_CANDIDATE_VALUE");
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
  throw new TypeError("UNSUPPORTED_CANDIDATE_VALUE");
}

export function hashConfirmationId(confirmationId: string): string {
  return createHash("sha256").update(confirmationId, "utf8").digest("hex");
}

export function canonicalCandidate(input: unknown): Readonly<{
  payload: MaterialCandidatePayload;
  sha256: string;
}> {
  const payload = MaterialCandidatePayloadSchema.parse(input);
  return {
    payload,
    sha256: createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex"),
  };
}
