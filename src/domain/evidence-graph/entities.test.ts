import { describe, expect, it } from "vitest";
import { ClaimSchema, ContractClauseSchema, ObservationSchema } from "./entities";
import { FindingSchema } from "./finding";

const caseId = "case_opaque_identifier_00001";
const claimId = "claim_opaque_identifier_0001";
const observationId = "observation_opaque_id_0001";
const clauseId = "clause_opaque_identifier_001";
const findingId = "finding_opaque_identifier_01";
const listingArtifactId = "listing_artifact_opaque_001";
const imageArtifactId = "viewing_artifact_opaque_001";
const contractArtifactId = "contract_artifact_opaque_01";

const listingLocator = {
  type: "text" as const,
  locatorId: "listing_locator_opaque_0001",
  artifactId: listingArtifactId,
  start: 0,
  end: 7,
  excerpt: "附洗衣機",
};

const imageLocator = {
  type: "image" as const,
  locatorId: "image_locator_opaque_000001",
  artifactId: imageArtifactId,
  bbox: [0.1, 0.1, 0.9, 0.9] as [number, number, number, number],
};

const contractLocator = {
  type: "pdf" as const,
  locatorId: "contract_locator_opaque_001",
  artifactId: contractArtifactId,
  page: 3,
  start: 20,
  end: 35,
  excerpt: "電費每度六元",
};

const claim = {
  id: claimId,
  caseId,
  artifactId: listingArtifactId,
  source: "listing" as const,
  category: "equipment" as const,
  key: "washing_machine",
  rawText: "附洗衣機",
  normalizedValue: { type: "boolean" as const, value: true },
  modelConfidence: 0.95,
  qualityFlags: [],
  locator: listingLocator,
};

const observation = {
  id: observationId,
  caseId,
  artifactId: imageArtifactId,
  key: "wall_discoloration",
  description: "牆面有一處顏色較深的區域",
  presence: "observed" as const,
  observedValue: { type: "text" as const, value: "局部顏色較深" },
  modelConfidence: 0.72,
  qualityFlags: [],
  uncertaintyReason: null,
  locator: imageLocator,
};

const contractClause = {
  id: clauseId,
  caseId,
  artifactId: contractArtifactId,
  semanticKey: "electricity_unit_rate",
  rawText: "電費每度六元",
  normalizedValue: {
    type: "unit_rate" as const,
    amountMinorPerUnit: 600,
    currency: "TWD" as const,
    unit: "kwh" as const,
  },
  modelConfidence: 0.98,
  qualityFlags: [],
  locator: contractLocator,
};

function evidenceRef(
  overrides: Partial<{
    relation: "supports" | "contradicts" | "context";
    basis: "explicit_value" | "absence" | "not_mentioned" | "not_shown";
    coverage: "complete" | "partial" | "not_shown";
    quality: "sufficient" | "low_confidence";
  }> = {},
) {
  return {
    sourceEntityType: "observation" as const,
    sourceEntityId: observationId,
    locator: imageLocator,
    relation: overrides.relation ?? "context",
    basis: overrides.basis ?? "not_shown",
    coverage: overrides.coverage ?? "not_shown",
    quality: overrides.quality ?? "sufficient",
    reasonCode: "EVIDENCE_SOURCE_REVIEWED",
  };
}

describe("evidence graph entities", () => {
  it("accepts strict Claim, Observation, and ContractClause entities", () => {
    expect(ClaimSchema.parse(claim)).toEqual(claim);
    expect(ObservationSchema.parse(observation)).toEqual(observation);
    expect(ContractClauseSchema.parse(contractClause)).toEqual(contractClause);
  });

  it.each([
    [ClaimSchema, claim],
    [ObservationSchema, observation],
    [ContractClauseSchema, contractClause],
  ])("requires a locator on every source entity", (schema, entity) => {
    const withoutLocator = Object.fromEntries(
      Object.entries(entity).filter(([key]) => key !== "locator"),
    );
    expect(schema.safeParse(withoutLocator).success).toBe(false);
  });

  it("rejects a locator that points at a different artifact", () => {
    expect(
      ClaimSchema.safeParse({
        ...claim,
        locator: { ...listingLocator, artifactId: contractArtifactId },
      }).success,
    ).toBe(false);
  });

  it("does not allow not-shown or unclear observations to carry an observed value", () => {
    expect(ObservationSchema.safeParse({ ...observation, observedValue: null }).success).toBe(
      false,
    );
    expect(
      ObservationSchema.safeParse({
        ...observation,
        presence: "not_shown",
        observedValue: { type: "boolean", value: false },
      }).success,
    ).toBe(false);
    expect(
      ObservationSchema.safeParse({
        ...observation,
        presence: "unclear",
        observedValue: null,
        uncertaintyReason: null,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown entity fields", () => {
    expect(ClaimSchema.safeParse({ ...claim, legalConclusion: "違法" }).success).toBe(false);
    expect(
      ClaimSchema.safeParse({
        ...claim,
        qualityFlags: ["blurred", "blurred"],
      }).success,
    ).toBe(false);
  });
});

describe("FindingSchema", () => {
  it("accepts contradiction only with explicit, complete, sufficient opposite evidence", () => {
    const result = FindingSchema.safeParse({
      findingType: "claim_comparison",
      id: findingId,
      caseId,
      claimId,
      status: "contradicted",
      reasonCode: "EXPLICIT_OPPOSITE_VALUE",
      evidenceRefs: [
        evidenceRef({
          relation: "contradicts",
          basis: "explicit_value",
          coverage: "complete",
          quality: "sufficient",
        }),
      ],
    });
    expect(result.success).toBe(true);
  });

  it("treats a washing machine not shown as insufficient evidence", () => {
    const result = FindingSchema.safeParse({
      findingType: "claim_comparison",
      id: findingId,
      caseId,
      claimId,
      status: "insufficient_evidence",
      reasonCode: "EQUIPMENT_NOT_SHOWN",
      evidenceRefs: [evidenceRef()],
    });
    expect(result.success).toBe(true);
  });

  it("never permits absence, not-mentioned, or not-shown evidence to contradict", () => {
    for (const basis of ["absence", "not_mentioned", "not_shown"] as const) {
      const result = FindingSchema.safeParse({
        findingType: "claim_comparison",
        id: findingId,
        caseId,
        claimId,
        status: "contradicted",
        reasonCode: "ABSENCE_IS_NOT_OPPOSITE",
        evidenceRefs: [
          evidenceRef({
            relation: "contradicts",
            basis,
            coverage: basis === "not_shown" ? "not_shown" : "complete",
          }),
        ],
      });
      expect(result.success).toBe(false);
    }
  });

  it("does not permit an explicit value when the source range was not shown", () => {
    expect(
      FindingSchema.safeParse({
        findingType: "claim_comparison",
        id: findingId,
        caseId,
        claimId,
        status: "insufficient_evidence",
        reasonCode: "SOURCE_RANGE_NOT_SHOWN",
        evidenceRefs: [
          evidenceRef({
            relation: "context",
            basis: "explicit_value",
            coverage: "not_shown",
          }),
        ],
      }).success,
    ).toBe(false);
  });

  it("does not permit low-confidence or partial opposite evidence to assert contradiction", () => {
    const lowConfidence = evidenceRef({
      relation: "contradicts",
      basis: "explicit_value",
      coverage: "complete",
      quality: "low_confidence",
    });
    expect(
      FindingSchema.safeParse({
        findingType: "claim_comparison",
        id: findingId,
        caseId,
        claimId,
        status: "contradicted",
        reasonCode: "LOW_CONFIDENCE_OPPOSITE",
        evidenceRefs: [lowConfidence],
      }).success,
    ).toBe(false);
    expect(
      FindingSchema.safeParse({
        findingType: "claim_comparison",
        id: findingId,
        caseId,
        claimId,
        status: "insufficient_evidence",
        reasonCode: "LOW_CONFIDENCE_OPPOSITE",
        evidenceRefs: [lowConfidence],
      }).success,
    ).toBe(true);
  });

  it("does not label adequate evidence insufficient or hide a contradiction behind support", () => {
    const support = evidenceRef({
      relation: "supports",
      basis: "explicit_value",
      coverage: "complete",
      quality: "sufficient",
    });
    const contradiction = evidenceRef({
      relation: "contradicts",
      basis: "explicit_value",
      coverage: "complete",
      quality: "sufficient",
    });
    expect(
      FindingSchema.safeParse({
        findingType: "claim_comparison",
        id: findingId,
        caseId,
        claimId,
        status: "insufficient_evidence",
        reasonCode: "WRONG_STATUS",
        evidenceRefs: [support],
      }).success,
    ).toBe(false);
    expect(
      FindingSchema.safeParse({
        findingType: "claim_comparison",
        id: findingId,
        caseId,
        claimId,
        status: "supported",
        reasonCode: "CONFLICTING_EVIDENCE",
        evidenceRefs: [support, contradiction],
      }).success,
    ).toBe(false);
  });

  it("requires locators and a concrete request for observation follow-up", () => {
    expect(
      FindingSchema.safeParse({
        findingType: "observation_follow_up",
        id: findingId,
        caseId,
        observationId,
        status: "additional_evidence_needed",
        reasonCode: "WALL_DISCOLORATION_NEEDS_MORE_EVIDENCE",
        evidenceRefs: [evidenceRef()],
        requiredEvidence: ["補拍牆面近照與相鄰天花板"],
      }).success,
    ).toBe(true);
    expect(
      FindingSchema.safeParse({
        findingType: "observation_follow_up",
        id: findingId,
        caseId,
        observationId,
        status: "additional_evidence_needed",
        reasonCode: "WALL_DISCOLORATION_NEEDS_MORE_EVIDENCE",
        evidenceRefs: [],
        requiredEvidence: [],
      }).success,
    ).toBe(false);
  });
});
