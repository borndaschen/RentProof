import { describe, expect, it } from "vitest";
import { composeCostSummary } from "../costs";
import type { Finding, SourceLocator } from "../evidence-graph";
import type { OfficialRuleCheck } from "../official-rules";
import { composePreSigningReport } from "./composer";
import { ReportCompositionError } from "./forbidden-language";
import {
  PreSigningReportInputSchema,
  PreSigningReportSchema,
  type PreSigningReportInput,
} from "./schema";

const ids = {
  claim: "claim-entity-000000001",
  observation: "observation-000000001",
  supported: "finding-supported-0001",
  contradicted: "finding-contradict-001",
  insufficient: "finding-insufficient-01",
  followUp: "finding-follow-up-0001",
  caseId: "case-entity-0000000001",
  locatorA: "locator-reference-00001",
  locatorB: "locator-reference-00002",
  locatorC: "locator-reference-00003",
  locatorD: "locator-reference-00004",
} as const;

function textLocator(
  locatorId: string,
  artifactId: string,
  excerpt: string,
): Extract<SourceLocator, { type: "text" }> {
  return { type: "text", locatorId, artifactId, start: 0, end: 10, excerpt };
}

const locators = {
  a: textLocator(ids.locatorA, "artifact-listing-0001", "廣告承諾內容"),
  b: textLocator(ids.locatorB, "artifact-contract-0001", "契約相反內容"),
  c: textLocator(ids.locatorC, "artifact-viewing-00001", "現場未涵蓋設備位置"),
  d: textLocator(ids.locatorD, "artifact-payment-00001", "看屋前付款要求"),
};

function claimFinding(
  id: string,
  status: "supported" | "contradicted" | "insufficient_evidence",
  locator: SourceLocator,
): Finding {
  const relation =
    status === "supported" ? "supports" : status === "contradicted" ? "contradicts" : "context";
  const adequate = status !== "insufficient_evidence";
  return {
    findingType: "claim_comparison",
    id,
    caseId: ids.caseId,
    claimId: ids.claim,
    status,
    reasonCode:
      status === "supported"
        ? "CLAIM_SUPPORTED"
        : status === "contradicted"
          ? "CLAIM_CONTRADICTED"
          : "CLAIM_EVIDENCE_INSUFFICIENT",
    evidenceRefs: [
      {
        sourceEntityType: "claim",
        sourceEntityId: ids.claim,
        locator,
        relation,
        basis: adequate ? "explicit_value" : "not_shown",
        coverage: adequate ? "complete" : "not_shown",
        quality: adequate ? "sufficient" : "low_confidence",
        reasonCode: adequate ? "EXPLICIT_VALUE" : "EXPECTED_AREA_NOT_SHOWN",
      },
    ],
  };
}

const observationFollowUp: Finding = {
  findingType: "observation_follow_up",
  id: ids.followUp,
  caseId: ids.caseId,
  observationId: ids.observation,
  status: "additional_evidence_needed",
  reasonCode: "ADDITIONAL_PHOTO_REQUIRED",
  evidenceRefs: [
    {
      sourceEntityType: "observation",
      sourceEntityId: ids.observation,
      locator: locators.c,
      relation: "context",
      basis: "not_shown",
      coverage: "partial",
      quality: "low_confidence",
      reasonCode: "PARTIAL_COVERAGE",
    },
  ],
  requiredEvidence: ["補拍牆面近照"],
};

const officialSource = {
  sourceId: "CURRENT_TERMS_PDF",
  title: "住宅租賃定型化契約應記載及不得記載事項",
  publisher: "行政院",
  url: "https://www.ey.gov.tw/example",
  snapshotSha256: "c".repeat(64),
  ruleLocator: "應記載事項第6點",
  rulesetVersion: "1.0.0-draft",
} as const;

function evaluatorId(ruleId: "RP-004" | "RP-009" | "RP-010") {
  return ruleId === "RP-004"
    ? "rent_and_fees_v1"
    : ruleId === "RP-009"
      ? "repair_responsibility_v1"
      : "rent_subsidy_restriction_v1";
}

function ruleCheck(
  ruleId: "RP-004" | "RP-009" | "RP-010",
  result: "no_difference_found" | "possible_difference" | "missing_information" | null,
): OfficialRuleCheck {
  if (result === null) {
    return {
      ruleId,
      evaluatorId: evaluatorId(ruleId),
      officialSource,
      caseLocators: [{ kind: "case_field", field: "case.general_residential_scope" }],
      applicability: "not_applicable",
      result: null,
      reasonCode: "RULE_NOT_APPLICABLE",
    };
  }
  return {
    ruleId,
    evaluatorId: evaluatorId(ruleId),
    officialSource,
    caseLocators: [{ kind: "contract_text", artifactId: "contract-1", page: 2, excerpt: "條款" }],
    applicability: "applicable",
    result,
    reasonCode:
      result === "possible_difference"
        ? "RULE_POSSIBLE_DIFFERENCE"
        : result === "missing_information"
          ? "RULE_INFORMATION_MISSING"
          : "RULE_NO_DIFFERENCE_FOUND",
  };
}

function validInput(): PreSigningReportInput {
  return {
    provenance: {
      snapshotId: "snapshot-000000000001",
      snapshotHash: "a".repeat(64),
      snapshotVersion: "analysis-snapshot.v1",
      manifestVersion: "golden-v1",
      manifestHash: "b".repeat(64),
      manifestSchema: "rentproof.demo-manifest.v1",
    },
    sourceLocators: [
      { refId: ids.locatorD, locator: locators.d },
      { refId: ids.locatorB, locator: locators.b },
      { refId: ids.locatorA, locator: locators.a },
      { refId: ids.locatorC, locator: locators.c },
    ],
    findings: [
      claimFinding(ids.insufficient, "insufficient_evidence", locators.c),
      claimFinding(ids.supported, "supported", locators.a),
      observationFollowUp,
      claimFinding(ids.contradicted, "contradicted", locators.b),
    ],
    ruleChecks: [
      { check: ruleCheck("RP-010", null), sourceRefIds: [ids.locatorB] },
      { check: ruleCheck("RP-004", "possible_difference"), sourceRefIds: [ids.locatorB] },
      { check: ruleCheck("RP-009", "missing_information"), sourceRefIds: [ids.locatorB] },
    ],
    fraudSignals: [
      {
        signalId: "FRS-001",
        status: "detected",
        action: "stop_and_verify",
        reasonCode: "FRS_001_PAYMENT_BEFORE_VIEWING",
        sourceRefIds: [ids.locatorD],
        missingInputs: [],
        humanVerificationRequired: true,
      },
    ],
    nonNaturalDeathDisclosureStatements: [],
    costSummary: composeCostSummary([
      {
        kind: "one_time",
        id: "deposit",
        label: "押金",
        amount: { currency: "TWD", minorUnits: "24000" },
      },
      {
        kind: "unit_rate",
        id: "electricity",
        label: "電費",
        rate: { currency: "TWD", minorUnitsPerUnit: "5", unit: "kwh" },
      },
      {
        kind: "fixed_monthly",
        id: "rent",
        label: "月租",
        amount: { currency: "TWD", minorUnits: "12000" },
      },
    ]),
    costSourceCoverage: [
      { costId: "rent", sourceRefIds: [ids.locatorA] },
      { costId: "electricity", sourceRefIds: [ids.locatorB] },
      { costId: "deposit", sourceRefIds: [ids.locatorB] },
    ],
  };
}

describe("composePreSigningReport", () => {
  it("groups neutral results and preserves print provenance", () => {
    const report = composePreSigningReport(validInput());
    expect(PreSigningReportSchema.safeParse(report).success).toBe(true);
    expect(report.provenance).toMatchObject({
      snapshotId: "snapshot-000000000001",
      snapshotHash: "a".repeat(64),
      manifestVersion: "golden-v1",
      manifestHash: "b".repeat(64),
    });
    expect(report.evidence.supported.map((item) => item.findingId)).toEqual([ids.supported]);
    expect(report.evidence.contradicted.map((item) => item.findingId)).toEqual([ids.contradicted]);
    expect(report.evidence.insufficientEvidence.map((item) => item.findingId)).toEqual([
      ids.insufficient,
    ]);
    expect(report.officialRules.possibleDifference.map((item) => item.ruleId)).toEqual(["RP-004"]);
    expect(report.officialRules.missingInformation.map((item) => item.ruleId)).toEqual(["RP-009"]);
    expect(report.paymentVerification[0]?.status).toBe("payment_verification_required");
    expect(report.nonNaturalDeathDisclosure.checks.map((check) => check.status)).toEqual([
      "insufficient_evidence",
      "insufficient_evidence",
    ]);
  });

  it("evaluates located yes/no statements into a first-class report field", () => {
    const input = validInput();
    input.nonNaturalDeathDisclosureStatements = [
      {
        statementId: "disclosure-owner-period-yes",
        subjectScope: "exclusive_area",
        period: "during_owner_holding",
        answer: "yes",
        eventTypes: ["other_non_natural_death"],
        sourceKind: "contract_clause",
        signedByProvider: false,
        locator: locators.b,
      },
      {
        statementId: "disclosure-known-before-no",
        subjectScope: "exclusive_area",
        period: "before_owner_holding_known",
        answer: "no",
        eventTypes: [],
        sourceKind: "landlord_written_statement",
        signedByProvider: false,
        locator: locators.a,
      },
    ];
    const report = composePreSigningReport(input);
    expect(report.nonNaturalDeathDisclosure.checks).toMatchObject([
      {
        period: "during_owner_holding",
        status: "supported",
        disclosedAnswer: "yes",
        sourceLocators: [locators.b],
      },
      {
        period: "before_owner_holding_known",
        status: "supported",
        disclosedAnswer: "no",
        sourceLocators: [locators.a],
      },
    ]);
  });

  it("keeps an unlocated unknown disclosure as insufficient evidence", () => {
    const input = validInput();
    input.nonNaturalDeathDisclosureStatements = [
      {
        statementId: "disclosure-unlocated-unknown-01",
        subjectScope: "exclusive_area",
        period: "during_owner_holding",
        answer: "unknown",
        eventTypes: [],
        sourceKind: "contract_clause",
        signedByProvider: false,
      },
    ];

    const report = composePreSigningReport(input);
    expect(report.nonNaturalDeathDisclosure.checks[0]).toMatchObject({
      status: "insufficient_evidence",
      disclosedAnswer: "unknown",
      sourceLocators: [],
    });
  });

  it("preserves located yes/no conflicts without producing a property verdict", () => {
    const input = validInput();
    input.nonNaturalDeathDisclosureStatements = [
      {
        statementId: "disclosure-conflict-yes-01",
        subjectScope: "exclusive_area",
        period: "during_owner_holding",
        answer: "yes",
        eventTypes: ["unspecified_non_natural_death"],
        sourceKind: "contract_clause",
        signedByProvider: false,
        locator: locators.a,
      },
      {
        statementId: "disclosure-conflict-no-001",
        subjectScope: "exclusive_area",
        period: "during_owner_holding",
        answer: "no",
        eventTypes: [],
        sourceKind: "agent_written_statement",
        signedByProvider: false,
        locator: locators.b,
      },
    ];
    const report = composePreSigningReport(input);
    expect(report.nonNaturalDeathDisclosure.checks[0]).toMatchObject({
      status: "contradicted",
      disclosedAnswer: "unknown",
      reasonCode: "EXPLICIT_DISCLOSURES_CONFLICT",
      sourceLocators: [locators.a, locators.b],
    });
    expect(JSON.stringify(report.nonNaturalDeathDisclosure)).not.toMatch(
      /是凶宅|不是凶宅|機率|責任|黑名單/u,
    );

    const sourceStrippedReport = {
      ...report,
      sources: report.sources.filter((source) => source.refId !== ids.locatorA),
    };
    expect(PreSigningReportSchema.safeParse(sourceStrippedReport).success).toBe(false);
  });

  it("uses deterministic action priority with targets, sources, and completion conditions", () => {
    const report = composePreSigningReport(validInput());
    expect(report.actions.map((action) => action.actionType)).toEqual([
      "verify",
      "ask",
      "modify",
      "attach",
      "photograph",
      "attach",
    ]);
    expect(report.actions.map((action) => action.priority)).toEqual([0, 10, 20, 25, 30, 30]);
    for (const action of report.actions) {
      expect(action.target.refId).not.toBe("");
      expect(action.sourceRefs.length).toBeGreaterThan(0);
      expect(action.completionConditions.length).toBeGreaterThan(0);
    }
  });

  it("keeps fixed, variable, and one-time costs separate without inventing usage", () => {
    const costs = composePreSigningReport(validInput()).costs;
    expect(costs.fixedMonthly.items.map((item) => item.id)).toEqual(["rent"]);
    expect(costs.variable.map((item) => item.id)).toEqual(["electricity"]);
    expect(costs.oneTime.items.map((item) => item.id)).toEqual(["deposit"]);
    expect(costs.monthlyScenarioTotal).toMatchObject({
      status: "usage_required",
      missingUsageCostIds: ["electricity"],
    });
  });

  it("is deterministic across input ordering", () => {
    const input = validInput();
    const reordered = {
      ...input,
      sourceLocators: [...input.sourceLocators].reverse(),
      findings: [...input.findings].reverse(),
      ruleChecks: [...input.ruleChecks].reverse(),
    };
    expect(composePreSigningReport(reordered)).toEqual(composePreSigningReport(input));
  });

  it("creates no actions for supported/acquired/no-difference/not-detected states", () => {
    const input = validInput();
    input.findings = [
      claimFinding(ids.supported, "supported", locators.a),
      { ...observationFollowUp, status: "evidence_acquired", requiredEvidence: [] },
    ];
    input.ruleChecks = [
      { check: ruleCheck("RP-010", "no_difference_found"), sourceRefIds: [ids.locatorB] },
    ];
    input.fraudSignals = [
      {
        signalId: "FRS-001",
        status: "not_detected_in_provided_data",
        action: "review",
        reasonCode: "FRS_001_PAYMENT_NOT_BEFORE_VIEWING",
        sourceRefIds: [ids.locatorD],
        missingInputs: [],
        humanVerificationRequired: true,
      },
    ];
    const report = composePreSigningReport(input);
    expect(report.actions).toEqual([]);
    expect(report.officialRules.noDifferenceFound.map((item) => item.ruleId)).toEqual(["RP-010"]);
    expect(report.paymentVerification[0]?.status).toBe("not_detected_in_provided_data");
  });

  it("turns incomplete payment facts into a neutral verification action", () => {
    const input = validInput();
    input.findings = [];
    input.ruleChecks = [];
    input.fraudSignals = [
      {
        signalId: "FRS-001",
        status: "insufficient_information",
        action: "review",
        reasonCode: "FRS_001_TIMELINE_INCOMPLETE",
        sourceRefIds: [ids.locatorD],
        missingInputs: ["first_in_person_viewing_at"],
        humanVerificationRequired: true,
      },
    ];
    const report = composePreSigningReport(input);
    expect(report.paymentVerification[0]?.status).toBe("insufficient_information");
    expect(report.actions).toMatchObject([
      { actionType: "verify", priority: 25, target: { kind: "fraud_signal" } },
    ]);
  });

  it("reports verify-before-payment and stop-and-verify signals in stable order", () => {
    const input = validInput();
    input.findings = [];
    input.ruleChecks = [];
    input.fraudSignals = [
      {
        signalId: "FRS-010",
        status: "detected",
        action: "stop_and_verify",
        reasonCode: "FRS_010_REDIRECTED_ACCOUNT_OR_BANK_VERIFICATION",
        sourceRefIds: [ids.locatorD],
        missingInputs: [],
        humanVerificationRequired: true,
      },
      {
        signalId: "FRS-002",
        status: "detected",
        action: "verify_before_payment",
        reasonCode: "FRS_002_REMOTE_OR_NO_IN_PERSON_VIEWING",
        sourceRefIds: [ids.locatorA],
        missingInputs: [],
        humanVerificationRequired: true,
      },
    ];

    const report = composePreSigningReport(input);
    expect(report.paymentVerification).toMatchObject([
      {
        signalId: "FRS-002",
        status: "payment_verification_required",
        action: "verify_before_payment",
        sourceRefs: [ids.locatorA],
      },
      {
        signalId: "FRS-010",
        status: "payment_verification_required",
        action: "stop_and_verify",
        sourceRefs: [ids.locatorD],
      },
    ]);
    expect(report.actions.map((action) => action.target.refId)).toEqual(["FRS-002", "FRS-010"]);
    expect(JSON.stringify(report)).not.toMatch(/確定詐騙|詐騙機率|安全分數|黑名單/u);
  });

  it("stably sorts every printable section with multiple entries", () => {
    const input = validInput();
    input.findings = [
      claimFinding("finding-supported-0002", "supported", locators.a),
      claimFinding(ids.supported, "supported", locators.a),
      claimFinding("finding-contradict-002", "contradicted", locators.b),
      claimFinding(ids.contradicted, "contradicted", locators.b),
      claimFinding("finding-insufficient-02", "insufficient_evidence", locators.c),
      claimFinding(ids.insufficient, "insufficient_evidence", locators.c),
    ];
    input.ruleChecks = [
      {
        check: ruleCheck("RP-010", "no_difference_found"),
        sourceRefIds: [ids.locatorB, ids.locatorA],
      },
      { check: ruleCheck("RP-004", "no_difference_found"), sourceRefIds: [ids.locatorB] },
      { check: ruleCheck("RP-010", "possible_difference"), sourceRefIds: [ids.locatorB] },
      { check: ruleCheck("RP-004", "possible_difference"), sourceRefIds: [ids.locatorB] },
      { check: ruleCheck("RP-009", "missing_information"), sourceRefIds: [ids.locatorB] },
      { check: ruleCheck("RP-004", "missing_information"), sourceRefIds: [ids.locatorB] },
    ];
    input.fraudSignals = [
      ...input.fraudSignals,
      {
        signalId: "FRS-002",
        status: "not_detected_in_provided_data",
        action: "review",
        reasonCode: "FRS_002_NO_REMOTE_VIEWING_CUE",
        sourceRefIds: [ids.locatorD],
        missingInputs: [],
        humanVerificationRequired: true,
      },
    ];
    input.costSummary = composeCostSummary([
      {
        kind: "fixed_monthly",
        id: "rent",
        label: "月租",
        amount: { currency: "TWD", minorUnits: "12000" },
      },
      {
        kind: "fixed_monthly",
        id: "network",
        label: "網路",
        amount: { currency: "TWD", minorUnits: "500" },
      },
      {
        kind: "unit_rate",
        id: "water",
        label: "水費",
        rate: { currency: "TWD", minorUnitsPerUnit: "20", unit: "water_unit" },
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
      {
        kind: "one_time",
        id: "cleaning",
        label: "清潔費",
        amount: { currency: "TWD", minorUnits: "1000" },
      },
    ]);
    input.costSourceCoverage = [
      "rent",
      "network",
      "water",
      "electricity",
      "deposit",
      "cleaning",
    ].map((costId) => ({ costId, sourceRefIds: [ids.locatorA] }));

    const report = composePreSigningReport(input);
    expect(report.evidence.supported.map((item) => item.findingId)).toEqual([
      ids.supported,
      "finding-supported-0002",
    ]);
    expect(report.costs.fixedMonthly.items.map((item) => item.id)).toEqual(["network", "rent"]);
    expect(report.costs.variable.map((item) => item.id)).toEqual(["electricity", "water"]);
    expect(report.costs.oneTime.items.map((item) => item.id)).toEqual(["cleaning", "deposit"]);
  });

  it("fails closed for missing/mismatched locator coverage and unknown keys", () => {
    const missingSource = validInput();
    missingSource.sourceLocators = missingSource.sourceLocators.filter(
      (source) => source.refId !== ids.locatorB,
    );
    expect(PreSigningReportInputSchema.safeParse(missingSource).success).toBe(false);
    const mismatched = validInput();
    const sourceIndex = mismatched.sourceLocators.findIndex(
      (source) => source.refId === ids.locatorA,
    );
    if (sourceIndex < 0) throw new Error("test fixture missing locator A");
    mismatched.sourceLocators[sourceIndex] = {
      refId: ids.locatorA,
      locator: { ...locators.a, excerpt: "不同內容" },
    };
    expect(PreSigningReportInputSchema.safeParse(mismatched).success).toBe(false);
    expect(PreSigningReportInputSchema.safeParse({ ...validInput(), extra: true }).success).toBe(
      false,
    );

    const duplicateSource = validInput();
    const firstSource = duplicateSource.sourceLocators[0];
    if (firstSource === undefined) throw new Error("test fixture missing source");
    duplicateSource.sourceLocators.push(firstSource);
    expect(PreSigningReportInputSchema.safeParse(duplicateSource).success).toBe(false);

    const invalidCostCoverage = validInput();
    invalidCostCoverage.costSourceCoverage[0] = {
      costId: "unknown-cost",
      sourceRefIds: [ids.locatorA],
    };
    expect(PreSigningReportInputSchema.safeParse(invalidCostCoverage).success).toBe(false);

    const incompleteCostCoverage = validInput();
    incompleteCostCoverage.costSourceCoverage = incompleteCostCoverage.costSourceCoverage.slice(1);
    expect(PreSigningReportInputSchema.safeParse(incompleteCostCoverage).success).toBe(false);

    const sourceIdMismatch = validInput();
    const source = sourceIdMismatch.sourceLocators[0];
    if (source === undefined) throw new Error("test fixture missing source");
    sourceIdMismatch.sourceLocators[0] = { ...source, refId: "different-reference-001" };
    expect(PreSigningReportInputSchema.safeParse(sourceIdMismatch).success).toBe(false);

    const missingFraudSource = validInput();
    const missingSourceSignal = missingFraudSource.fraudSignals[0];
    if (missingSourceSignal === undefined) throw new Error("test fixture missing fraud signal");
    missingFraudSource.fraudSignals[0] = {
      ...missingSourceSignal,
      sourceRefIds: ["unregistered-fraud-locator"],
    };
    expect(PreSigningReportInputSchema.safeParse(missingFraudSource).success).toBe(false);

    const duplicateFraudSignal = validInput();
    const fraudSignal = duplicateFraudSignal.fraudSignals[0];
    if (fraudSignal === undefined) throw new Error("test fixture missing fraud signal");
    duplicateFraudSignal.fraudSignals.push({ ...fraudSignal });
    expect(PreSigningReportInputSchema.safeParse(duplicateFraudSignal).success).toBe(false);

    const detectedWithoutAction = validInput();
    const detectedSignal = detectedWithoutAction.fraudSignals[0];
    if (detectedSignal === undefined) throw new Error("test fixture missing fraud signal");
    detectedWithoutAction.fraudSignals[0] = { ...detectedSignal, action: "review" };
    expect(PreSigningReportInputSchema.safeParse(detectedWithoutAction).success).toBe(false);

    const negativeWithEscalatedAction = validInput();
    const negativeSignal = negativeWithEscalatedAction.fraudSignals[0];
    if (negativeSignal === undefined) throw new Error("test fixture missing fraud signal");
    negativeWithEscalatedAction.fraudSignals[0] = {
      ...negativeSignal,
      status: "not_detected_in_provided_data",
      action: "stop_and_verify",
    };
    expect(PreSigningReportInputSchema.safeParse(negativeWithEscalatedAction).success).toBe(false);

    const unregisteredDisclosureLocator = validInput();
    unregisteredDisclosureLocator.nonNaturalDeathDisclosureStatements = [
      {
        statementId: "disclosure-unregistered-01",
        subjectScope: "exclusive_area",
        period: "during_owner_holding",
        answer: "no",
        eventTypes: [],
        sourceKind: "contract_clause",
        signedByProvider: false,
        locator: textLocator("locator-unregistered-001", "artifact-contract-0001", "未註冊來源"),
      },
    ];
    expect(PreSigningReportInputSchema.safeParse(unregisteredDisclosureLocator).success).toBe(
      false,
    );
  });

  it("fails closed when any printable field contains forbidden verdict language", () => {
    const input = validInput();
    const first = input.costSummary.fixedMonthly.items[0];
    if (first === undefined) throw new Error("test fixture missing fixed cost");
    input.costSummary.fixedMonthly.items[0] = { ...first, label: "確定詐騙費用" };
    expect(() => composePreSigningReport(input)).toThrowError(
      new ReportCompositionError("REPORT_FORBIDDEN_LANGUAGE"),
    );
  });
});
