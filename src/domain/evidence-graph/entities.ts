import { z } from "zod";
import { NormalizedValueSchema } from "./normalized-value";
import {
  EvidenceGraphIdSchema,
  EvidenceKeySchema,
  ModelConfidenceSchema,
  NonBlankTextSchema,
  QualityFlagsSchema,
} from "./primitives";
import { SourceLocatorSchema } from "./source-locator";

function addArtifactIntegrityIssue(
  artifactId: string,
  locatorArtifactId: string,
  context: z.core.$RefinementCtx,
): void {
  if (artifactId !== locatorArtifactId) {
    context.addIssue({ code: "custom", message: "LOCATOR_ARTIFACT_MISMATCH" });
  }
}

export const ClaimSchema = z
  .object({
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    source: z.enum(["listing", "spoken_promise"]),
    category: z.enum(["rent", "fee", "equipment", "condition", "subsidy", "other"]),
    key: EvidenceKeySchema,
    rawText: NonBlankTextSchema,
    normalizedValue: NormalizedValueSchema,
    modelConfidence: ModelConfidenceSchema.nullable(),
    qualityFlags: QualityFlagsSchema,
    locator: SourceLocatorSchema,
  })
  .strict()
  .superRefine((claim, context) => {
    addArtifactIntegrityIssue(claim.artifactId, claim.locator.artifactId, context);
  });

export const ObservationSchema = z
  .object({
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    key: EvidenceKeySchema,
    description: NonBlankTextSchema,
    presence: z.enum(["observed", "not_shown", "unclear"]),
    observedValue: NormalizedValueSchema.nullable(),
    modelConfidence: ModelConfidenceSchema.nullable(),
    qualityFlags: QualityFlagsSchema,
    uncertaintyReason: z.string().min(1).max(500).nullable(),
    locator: SourceLocatorSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    addArtifactIntegrityIssue(observation.artifactId, observation.locator.artifactId, context);
    if (observation.presence === "observed" && observation.observedValue === null) {
      context.addIssue({ code: "custom", message: "OBSERVED_VALUE_REQUIRED" });
    }
    if (observation.presence !== "observed" && observation.observedValue !== null) {
      context.addIssue({ code: "custom", message: "UNOBSERVED_VALUE_FORBIDDEN" });
    }
    if (observation.presence === "unclear" && observation.uncertaintyReason === null) {
      context.addIssue({ code: "custom", message: "UNCERTAINTY_REASON_REQUIRED" });
    }
  });

export const ContractClauseSchema = z
  .object({
    id: EvidenceGraphIdSchema,
    caseId: EvidenceGraphIdSchema,
    artifactId: EvidenceGraphIdSchema,
    semanticKey: EvidenceKeySchema,
    rawText: NonBlankTextSchema,
    normalizedValue: NormalizedValueSchema.nullable(),
    modelConfidence: ModelConfidenceSchema.nullable(),
    qualityFlags: QualityFlagsSchema,
    locator: SourceLocatorSchema,
  })
  .strict()
  .superRefine((clause, context) => {
    addArtifactIntegrityIssue(clause.artifactId, clause.locator.artifactId, context);
  });

export type Claim = z.infer<typeof ClaimSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type ContractClause = z.infer<typeof ContractClauseSchema>;
