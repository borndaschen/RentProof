import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { verifyAndParseManifestBytes } from "@/adapters/demo/manifest-bytes";
import { verifyFullDemoForTestOrEval } from "@/adapters/demo/test-eval-full-verifier";
import { composeCostSummary } from "@/domain/costs";
import { FindingSchema } from "@/domain/evidence-graph";
import type { Finding, SourceLocator } from "@/domain/evidence-graph";
import { compareClaim } from "@/domain/evidence/claim-comparison";
import { evaluateFrs001 } from "@/domain/fraud/frs-001";
import {
  evaluateElectricityInformation,
  evaluatePerKwhElectricity,
  evaluateRentAndFees,
  evaluateRentalScopeAndEquipment,
  evaluateRentSubsidyRestriction,
  evaluateRepairResponsibility,
} from "@/domain/official-rules";
import type { OfficialRuleCheck, OfficialSourceReference } from "@/domain/official-rules";
import { composePreSigningReport } from "@/domain/reporting/composer";

const demoRoot =
  process.env["RENTPROOF_DEMO_DIR"]?.trim() ||
  join(process.env["USERPROFILE"] ?? "", "RentProof-Demo");
const caseRoot = join(demoRoot, "cases", "golden-v1");
const externalFixtureExists = existsSync(join(caseRoot, "manifest.json"));

const GoldenTruthSchema = z
  .object({
    schema: z.literal("rentproof.golden-truth.v1"),
    synthetic: z.literal(true),
    claims: z.array(
      z
        .object({
          id: z.string(),
          expected: z.enum(["supported", "contradicted", "insufficient_evidence"]),
        })
        .passthrough(),
    ),
    observation: z
      .object({
        id: z.literal("observation-wall-mark"),
        expected: z.literal("follow_up_required"),
        forbiddenConclusions: z.array(z.enum(["leak", "structural_damage", "liability"])),
        requiredAction: z.string(),
      })
      .passthrough(),
    fraudSignal: z
      .object({
        id: z.literal("FRS-001"),
        expected: z.literal("signal_present"),
        forbiddenOutputs: z.array(z.enum(["fraud_verdict", "fraud_probability", "safety_score"])),
      })
      .passthrough(),
    ruleChecks: z.array(
      z
        .object({
          ruleId: z.enum(["RP-003", "RP-004", "RP-006", "RP-008", "RP-009", "RP-010"]),
          expected: z.enum(["no_difference_found", "possible_difference", "missing_information"]),
        })
        .strict(),
    ),
  })
  .strict();

const caseId = "case_golden_integration_001";
const locators = {
  listing: {
    type: "text",
    locatorId: "locator_golden_listing_001",
    artifactId: "listing-synthetic-listing-png",
    start: 0,
    end: 40,
    excerpt: "月租12000元、附洗衣機、電費每度5元、可申請租金補貼",
  },
  viewing: {
    type: "image",
    locatorId: "locator_golden_viewing_001",
    artifactId: "viewing-view-10-jpg-source",
    bbox: [0.1, 0.1, 0.9, 0.9],
  },
  contract: {
    type: "pdf",
    locatorId: "locator_golden_contract_01",
    artifactId: "contract-synthetic-lease-pdf",
    page: 3,
    start: 0,
    end: 40,
    excerpt: "電費每度6元，且契約文字限制申請租金補貼",
  },
  payment: {
    type: "text",
    locatorId: "locator_golden_payment_001",
    artifactId: "interaction-payment-request-json",
    start: 0,
    end: 30,
    excerpt: "第一次實地看屋前要求先支付預約金",
  },
} as const satisfies Record<string, SourceLocator>;

function expectedClaim(truth: z.infer<typeof GoldenTruthSchema>, id: string) {
  const entry = truth.claims.find((claim) => claim.id === id);
  if (entry === undefined) throw new Error(`GOLDEN_TRUTH_CLAIM_MISSING:${id}`);
  return entry.expected;
}

function finding(options: {
  id: string;
  claimId: string;
  status: "supported" | "contradicted" | "insufficient_evidence";
  locator: SourceLocator;
}): Extract<Finding, { findingType: "claim_comparison" }> {
  const relation =
    options.status === "supported"
      ? "supports"
      : options.status === "contradicted"
        ? "contradicts"
        : "context";
  const explicit = options.status !== "insufficient_evidence";
  const parsed = FindingSchema.parse({
    findingType: "claim_comparison",
    id: options.id,
    caseId,
    claimId: options.claimId,
    status: options.status,
    reasonCode:
      options.status === "supported"
        ? "CLAIM_SUPPORTED"
        : options.status === "contradicted"
          ? "CLAIM_EXPLICIT_CONTRADICTION"
          : "CLAIM_EVIDENCE_INSUFFICIENT",
    evidenceRefs: [
      {
        sourceEntityType: "claim",
        sourceEntityId: options.claimId,
        locator: options.locator,
        relation,
        basis: explicit ? "explicit_value" : "not_shown",
        coverage: explicit ? "complete" : "not_shown",
        quality: explicit ? "sufficient" : "low_confidence",
        reasonCode: explicit ? "EXPLICIT_VALUE" : "EXPECTED_AREA_NOT_SHOWN",
      },
    ],
  });
  if (parsed.findingType !== "claim_comparison") {
    throw new Error("CLAIM_FINDING_SCHEMA_MISMATCH");
  }
  return parsed;
}

function officialSource(sourceId: string): OfficialSourceReference {
  return {
    sourceId,
    title: `Synthetic official source ${sourceId}`,
    publisher: "Synthetic Government Source",
    url: `https://example.gov.tw/${sourceId.toLowerCase()}`,
    snapshotSha256: "a".repeat(64),
    ruleLocator: "Synthetic verified rule locator",
    rulesetVersion: "1.0.0-draft",
  };
}

function evaluationContext(sourceId: string) {
  return {
    generalResidentialScope: true,
    intendedSignedAt: "2026-09-10",
    officialSource: officialSource(sourceId),
    caseLocators: [
      {
        kind: "contract_text" as const,
        artifactId: "contract-synthetic-lease-pdf",
        page: 3,
        excerpt: "Synthetic Golden 契約規則核對位置",
      },
    ],
  };
}

function evaluateSixRules(): OfficialRuleCheck[] {
  return [
    evaluateRentalScopeAndEquipment({
      ...evaluationContext("CONTRACT_TEMPLATE"),
      contractDocument: "complete",
      rentalScope: "complete",
      equipmentAppendix: "not_present",
    }),
    evaluateRentAndFees({
      ...evaluationContext("CURRENT_TERMS_PDF"),
      contractDocument: "complete",
      monthlyRent: "present",
      fees: "incomplete",
      allowsUnilateralRentIncrease: "unknown",
    }),
    evaluatePerKwhElectricity({
      ...evaluationContext("ELECTRICITY_2024"),
      electricityPayer: "tenant",
      billingMode: "per_kwh",
      chargedRate: { state: "known", value: "6" },
      billAverageUnitPrice: { state: "unknown" },
      billMatch: "unknown",
    }),
    evaluateElectricityInformation({
      ...evaluationContext("ELECTRICITY_2024"),
      electricityPayer: "tenant",
      billInformation: {
        averageUnitPrice: "unknown",
        usageKwh: "unknown",
        totalAmount: "unknown",
        publicAreaAllocation: "unknown",
      },
      blocksTenantBillInquiry: "unknown",
    }),
    evaluateRepairResponsibility({
      ...evaluationContext("CURRENT_TERMS_PDF"),
      tenantRepairItems: "incomplete",
      repairContact: "not_present",
      assignsAllRepairsWithoutItemization: "unknown",
    }),
    evaluateRentSubsidyRestriction({
      ...evaluationContext("SUBSIDY_2023"),
      contractDocument: "complete",
      restrictionClause: "present",
    }),
  ];
}

describe("Golden case integrated truth", () => {
  it.skipIf(!externalFixtureExists)(
    "verifies sealed truth through deterministic evaluators without provider or fallback",
    async () => {
      const verified = verifyAndParseManifestBytes(
        await readFile(join(caseRoot, "manifest.json")),
        await readFile(join(caseRoot, "manifest.sha256")),
      );
      expect(verified.manifest).toMatchObject({
        caseVersion: "golden-v1",
        synthetic: true,
      });
      expect(verified.manifest.files).toHaveLength(18);
      const evaluation = await verifyFullDemoForTestOrEval({
        caseRoot,
        manifest: verified.manifest,
        parseTruth: (value) => GoldenTruthSchema.parse(value),
      });
      const truth = evaluation.truth;

      const statuses = {
        rent: compareClaim([
          {
            coverage: "complete",
            locatorValid: true,
            quality: "sufficient",
            relation: "same",
          },
        ]),
        washingMachine: compareClaim([
          {
            coverage: "not_shown",
            locatorValid: true,
            quality: "sufficient",
            relation: "not_mentioned",
          },
        ]),
        electricity: compareClaim([
          {
            coverage: "complete",
            locatorValid: true,
            quality: "sufficient",
            relation: "opposite",
          },
        ]),
        subsidy: compareClaim([
          {
            coverage: "complete",
            locatorValid: true,
            quality: "sufficient",
            relation: "opposite",
          },
        ]),
      };
      expect(statuses.rent).toBe(expectedClaim(truth, "claim-rent"));
      expect(statuses.washingMachine).toBe(expectedClaim(truth, "claim-washing-machine"));
      expect(statuses.electricity).toBe(expectedClaim(truth, "claim-electricity-rate"));
      expect(statuses.subsidy).toBe(expectedClaim(truth, "claim-rent-subsidy"));

      const claimFindings = [
        finding({
          id: "finding_golden_rent_0001",
          claimId: "claim_golden_rent_000001",
          status: statuses.rent,
          locator: locators.listing,
        }),
        finding({
          id: "finding_golden_washer_001",
          claimId: "claim_golden_washer_0001",
          status: statuses.washingMachine,
          locator: locators.viewing,
        }),
        finding({
          id: "finding_golden_electric_01",
          claimId: "claim_golden_electric_001",
          status: statuses.electricity,
          locator: locators.contract,
        }),
        finding({
          id: "finding_golden_subsidy_001",
          claimId: "claim_golden_subsidy_0001",
          status: statuses.subsidy,
          locator: locators.contract,
        }),
      ];
      const wallFollowUp = FindingSchema.parse({
        findingType: "observation_follow_up",
        id: "finding_golden_wall_follow1",
        caseId,
        observationId: "observation_golden_wall_001",
        status: "additional_evidence_needed",
        reasonCode: "WALL_MARK_REQUIRES_FOLLOW_UP",
        evidenceRefs: [
          {
            sourceEntityType: "observation",
            sourceEntityId: "observation_golden_wall_001",
            locator: locators.viewing,
            relation: "context",
            basis: "explicit_value",
            coverage: "complete",
            quality: "sufficient",
            reasonCode: "VISIBLE_WALL_MARK",
          },
        ],
        requiredEvidence: ["補拍牆面、天花板與相鄰表面，並詢問修繕紀錄"],
      });
      expect(wallFollowUp.status).toBe("additional_evidence_needed");
      expect(JSON.stringify(wallFollowUp)).not.toMatch(/漏水|結構損壞|責任歸屬/u);
      expect(truth.observation.forbiddenConclusions).toEqual(
        expect.arrayContaining(["leak", "structural_damage", "liability"]),
      );

      const fraud = evaluateFrs001({
        paymentRequestEvidence: {
          present: true,
          locatorId: locators.payment.locatorId,
        },
        paymentRequestedAt: { status: "known", value: "2026-09-01T10:00:00.000Z" },
        firstInPersonViewingAt: {
          status: "known",
          value: "2026-09-02T10:00:00.000Z",
        },
      });
      expect(fraud).toMatchObject({
        signalId: truth.fraudSignal.id,
        status: "detected",
        action: "stop_and_verify",
        reasonCode: "FRS_001_PAYMENT_BEFORE_VIEWING",
      });

      const ruleChecks = evaluateSixRules();
      expect(ruleChecks).toHaveLength(6);
      for (const expected of truth.ruleChecks) {
        const actual = ruleChecks.find((check) => check.ruleId === expected.ruleId);
        expect(actual?.result).toBe(expected.expected);
      }

      const costSummary = composeCostSummary([
        {
          kind: "fixed_monthly",
          id: "rent",
          label: "月租",
          amount: { currency: "TWD", minorUnits: "12000" },
        },
        {
          kind: "unit_rate",
          id: "electricity",
          label: "電費",
          rate: { currency: "TWD", minorUnitsPerUnit: "5", unit: "kwh" },
        },
        {
          kind: "one_time",
          id: "deposit",
          label: "押金",
          amount: { currency: "TWD", minorUnits: "24000" },
        },
      ]);
      expect(costSummary).toMatchObject({
        fixedMonthly: { total: { currency: "TWD", minorUnits: "12000" } },
        variable: [
          {
            id: "electricity",
            formula: { minorUnitsPerUnit: "5", unit: "kwh" },
            scenario: { status: "usage_required" },
          },
        ],
        oneTime: { total: { currency: "TWD", minorUnits: "24000" } },
        monthlyScenarioTotal: { status: "usage_required" },
      });

      const sources = Object.values(locators).map((locator) => ({
        refId: locator.locatorId,
        locator,
      }));
      const report = composePreSigningReport({
        provenance: {
          snapshotId: "snapshot_golden_integrated_01",
          snapshotHash: "b".repeat(64),
          snapshotVersion: "golden-integrated.v1",
          manifestVersion: "golden-v1",
          manifestHash: verified.manifestSha256,
          manifestSchema: "rentproof.demo-manifest.v1",
        },
        sourceLocators: sources,
        findings: [...claimFindings, wallFollowUp],
        ruleChecks: ruleChecks.map((check) => ({
          check,
          sourceRefIds: [locators.contract.locatorId],
        })),
        fraudSignals: [
          {
            signalId: fraud.signalId,
            status: fraud.status,
            action: fraud.action,
            reasonCode: fraud.reasonCode,
            sourceRefIds: fraud.evidenceRefs,
            missingInputs: fraud.missingInputs,
            humanVerificationRequired: fraud.humanVerificationRequired,
          },
        ],
        nonNaturalDeathDisclosureStatements: [],
        costSummary,
        costSourceCoverage: [
          { costId: "rent", sourceRefIds: [locators.listing.locatorId] },
          { costId: "electricity", sourceRefIds: [locators.contract.locatorId] },
          { costId: "deposit", sourceRefIds: [locators.contract.locatorId] },
        ],
      });

      expect(report.actions[0]).toMatchObject({
        priority: 0,
        actionType: "verify",
        target: { kind: "fraud_signal", refId: "FRS-001" },
        sourceRefs: [locators.payment.locatorId],
      });
      expect(report.actions.every((action) => action.sourceRefs.length > 0)).toBe(true);
      expect(report.sources).toHaveLength(4);
      expect(report.provenance).toMatchObject({
        manifestVersion: "golden-v1",
        manifestHash: verified.manifestSha256,
        manifestSchema: "rentproof.demo-manifest.v1",
      });
      expect(JSON.stringify(report)).not.toMatch(
        /違法|合法|確定詐騙|就是詐騙|詐騙機率|安全分數|安全無虞|房東有責|責任歸屬/u,
      );
    },
    20_000,
  );
});
