import { z } from "zod";

export const ClaimComparisonStatusSchema = z.enum([
  "supported",
  "contradicted",
  "insufficient_evidence",
]);

export type ClaimComparisonStatus = z.infer<typeof ClaimComparisonStatusSchema>;

export type ComparableEvidence = {
  coverage: "complete" | "partial" | "not_shown";
  locatorValid: boolean;
  quality: "sufficient" | "low_confidence";
  relation: "same" | "opposite" | "not_mentioned";
};

export function compareClaim(evidence: readonly ComparableEvidence[]): ClaimComparisonStatus {
  const valid = evidence.filter(
    (item) => item.locatorValid && item.quality === "sufficient" && item.coverage === "complete",
  );
  if (valid.some((item) => item.relation === "opposite")) return "contradicted";
  if (valid.some((item) => item.relation === "same")) return "supported";
  return "insufficient_evidence";
}
