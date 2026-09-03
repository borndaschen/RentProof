import { z } from "zod";
import { EvidenceGraphIdSchema, NonBlankTextSchema, ReasonCodeSchema } from "./primitives";
import { SourceLocatorSchema } from "./source-locator";

const EvidenceRefSchema = z
  .object({
    sourceEntityType: z.enum(["claim", "observation", "contract_clause"]),
    sourceEntityId: EvidenceGraphIdSchema,
    locator: SourceLocatorSchema,
    relation: z.enum(["supports", "contradicts", "context"]),
    basis: z.enum(["explicit_value", "absence", "not_mentioned", "not_shown"]),
    coverage: z.enum(["complete", "partial", "not_shown"]),
    quality: z.enum(["sufficient", "low_confidence"]),
    reasonCode: ReasonCodeSchema,
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.relation !== "context" && reference.basis !== "explicit_value") {
      context.addIssue({ code: "custom", message: "ABSENCE_CANNOT_ASSERT_RELATION" });
    }
    if (reference.coverage === "not_shown" && reference.basis === "explicit_value") {
      context.addIssue({ code: "custom", message: "UNSHOWN_EVIDENCE_CANNOT_BE_EXPLICIT" });
    }
  });

const ClaimComparisonFindingSchema = z
  .object({
    findingType: z.literal("claim_comparison"),
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    claimId: EvidenceGraphIdSchema,
    status: z.enum(["supported", "contradicted", "insufficient_evidence"]),
    reasonCode: ReasonCodeSchema,
    evidenceRefs: z.array(EvidenceRefSchema).min(1).max(20),
  })
  .strict();

const ObservationFollowUpFindingSchema = z
  .object({
    findingType: z.literal("observation_follow_up"),
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    observationId: EvidenceGraphIdSchema,
    status: z.enum(["evidence_acquired", "additional_evidence_needed"]),
    reasonCode: ReasonCodeSchema,
    evidenceRefs: z.array(EvidenceRefSchema).min(1).max(20),
    requiredEvidence: z.array(NonBlankTextSchema).max(10),
  })
  .strict()
  .superRefine((finding, context) => {
    if (finding.status === "additional_evidence_needed" && finding.requiredEvidence.length === 0) {
      context.addIssue({ code: "custom", message: "REQUIRED_EVIDENCE_MUST_BE_SPECIFIED" });
    }
  });

function isAdequateExplicitReference(
  reference: z.infer<typeof EvidenceRefSchema>,
  relation: "supports" | "contradicts",
): boolean {
  return (
    reference.relation === relation &&
    reference.basis === "explicit_value" &&
    reference.coverage === "complete" &&
    reference.quality === "sufficient"
  );
}

export const FindingSchema = z
  .discriminatedUnion("findingType", [
    ClaimComparisonFindingSchema,
    ObservationFollowUpFindingSchema,
  ])
  .superRefine((finding, context) => {
    if (finding.findingType !== "claim_comparison") {
      return;
    }

    const hasContradiction = finding.evidenceRefs.some((reference) =>
      isAdequateExplicitReference(reference, "contradicts"),
    );
    const hasSupport = finding.evidenceRefs.some((reference) =>
      isAdequateExplicitReference(reference, "supports"),
    );

    if (finding.status === "contradicted" && !hasContradiction) {
      context.addIssue({ code: "custom", message: "CONTRADICTION_REQUIRES_EXPLICIT_EVIDENCE" });
    }
    if (finding.status === "supported" && (!hasSupport || hasContradiction)) {
      context.addIssue({ code: "custom", message: "SUPPORT_REQUIRES_UNOPPOSED_EXPLICIT_EVIDENCE" });
    }
    if (finding.status === "insufficient_evidence" && (hasSupport || hasContradiction)) {
      context.addIssue({ code: "custom", message: "ADEQUATE_EVIDENCE_CANNOT_BE_INSUFFICIENT" });
    }
  });

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type Finding = z.infer<typeof FindingSchema>;
