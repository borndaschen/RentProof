import { composeCostSummary } from "@/domain/costs";
import type { Finding, SourceLocator } from "@/domain/evidence-graph";
import type { OfficialRuleCheck, OfficialSourceReference } from "@/domain/official-rules";
import type { OfficialRuleProfile } from "@/domain/official-rules";
import { composePreSigningReport, type PreSigningReport } from "@/domain/reporting";

const ids = {
  caseId: "case-golden-report-0001",
  claimSupported: "claim-supported-0000001",
  claimContradicted: "claim-contradicted-001",
  claimInsufficient: "claim-insufficient-001",
  findingSupported: "finding-supported-0001",
  findingContradicted: "finding-contradict-001",
  findingInsufficient: "finding-insufficient-01",
  listingLocator: "locator-listing-000001",
  contractLocator: "locator-contract-00001",
  viewingLocator: "locator-viewing-000001",
  paymentLocator: "locator-payment-000001",
} as const;

function textLocator(
  locatorId: string,
  artifactId: string,
  excerpt: string,
): Extract<SourceLocator, { type: "text" }> {
  return { type: "text", locatorId, artifactId, start: 0, end: 20, excerpt };
}

const sources = {
  listing: textLocator(
    ids.listingLocator,
    "listing-synthetic-listing-png",
    "月租 NT$12,000，附洗衣機。",
  ),
  contract: textLocator(
    ids.contractLocator,
    "contract-synthetic-lease-pdf",
    "電費依契約所列方式計算。",
  ),
  viewing: textLocator(
    ids.viewingLocator,
    "follow-up-wall-close-up-png",
    "補拍影像仍需搭配設備附件確認。",
  ),
  payment: textLocator(
    ids.paymentLocator,
    "interaction-payment-request-json",
    "首次實地看屋前提出付款要求。",
  ),
};

function claimFinding(options: {
  id: string;
  claimId: string;
  status: "supported" | "contradicted" | "insufficient_evidence";
  locator: SourceLocator;
}): Finding {
  const adequate = options.status !== "insufficient_evidence";
  const relation =
    options.status === "supported"
      ? "supports"
      : options.status === "contradicted"
        ? "contradicts"
        : "context";
  return {
    findingType: "claim_comparison",
    id: options.id,
    caseId: ids.caseId,
    claimId: options.claimId,
    status: options.status,
    reasonCode:
      options.status === "supported"
        ? "CLAIM_SUPPORTED"
        : options.status === "contradicted"
          ? "CLAIM_CONTRADICTED"
          : "CLAIM_EVIDENCE_INSUFFICIENT",
    evidenceRefs: [
      {
        sourceEntityType: "claim",
        sourceEntityId: options.claimId,
        locator: options.locator,
        relation,
        basis: adequate ? "explicit_value" : "not_shown",
        coverage: adequate ? "complete" : "not_shown",
        quality: adequate ? "sufficient" : "low_confidence",
        reasonCode: adequate ? "EXPLICIT_VALUE" : "EXPECTED_AREA_NOT_SHOWN",
      },
    ],
  };
}

const officialSources = {
  contractTemplate: {
    sourceId: "CONTRACT_TEMPLATE",
    title: "住宅租賃契約書範本",
    publisher: "內政部不動產資訊平台",
    url: "https://pip.moi.gov.tw/Publicize/Info/G1020",
    snapshotSha256: "012ed306a85a76d30c09e4f15943509a81ae4a55443e7e8d97a8c9ee1f0b420b",
    ruleLocator: "租賃標的與附件一租賃標的現況確認書",
    rulesetVersion: "1.0.0-draft",
  },
  currentTerms: {
    sourceId: "CURRENT_TERMS_PDF",
    title: "住宅租賃定型化契約應記載及不得記載事項",
    publisher: "行政院",
    url: "https://www.ey.gov.tw/Page/DFB720D019CCCB0A/478917df-7599-418f-8715-fd2716b623b4",
    snapshotSha256: "fb25806446b812295e95237409e51f4eccffef18c134db126ded65610d2ddbb4",
    ruleLocator: "應記載事項",
    rulesetVersion: "1.0.0-draft",
  },
  electricity: {
    sourceId: "ELECTRICITY_2024",
    title: "住宅租賃定型化契約電費規定修正",
    publisher: "內政部",
    url: "https://www.moi.gov.tw/News_Content.aspx?n=145&s=317657",
    snapshotSha256: "e42c7e7bea8b8b3568a79c5c938bb12023b5bd3c7e3cfedd9e3450f48dd4666d",
    ruleLocator: "應記載事項第6點第3款、第11點",
    rulesetVersion: "1.0.0-draft",
  },
  subsidy: {
    sourceId: "SUBSIDY_2023",
    title: "租金補貼不得記載事項修正",
    publisher: "內政部",
    url: "https://www.moi.gov.tw/News_Content.aspx?n=145&s=280625",
    snapshotSha256: "57ad6ecc21739a979f0edaa1b07c22ab6dce07222655dd897545e1c47ec5771b",
    ruleLocator: "不得記載事項第10點",
    rulesetVersion: "1.0.0-draft",
  },
} satisfies Record<string, OfficialSourceReference>;

function createRuleCheck(options: {
  ruleId: OfficialRuleCheck["ruleId"];
  evaluatorId: OfficialRuleCheck["evaluatorId"];
  source: OfficialSourceReference;
  result: "no_difference_found" | "possible_difference" | "missing_information";
  reasonCode: string;
}): OfficialRuleCheck {
  return {
    ruleId: options.ruleId,
    evaluatorId: options.evaluatorId,
    officialSource: options.source,
    caseLocators: [
      {
        kind: "contract_text",
        artifactId: "contract-synthetic-lease-pdf",
        page: 3,
        excerpt: "Synthetic Golden 契約規則核對位置。",
      },
    ],
    applicability: "applicable",
    result: options.result,
    reasonCode: options.reasonCode,
  };
}

const p0RuleChecks = [
  createRuleCheck({
    ruleId: "RP-003",
    evaluatorId: "rental_scope_and_equipment_v1",
    source: officialSources.contractTemplate,
    result: "missing_information",
    reasonCode: "RENTAL_SCOPE_OR_EQUIPMENT_MISSING",
  }),
  createRuleCheck({
    ruleId: "RP-004",
    evaluatorId: "rent_and_fees_v1",
    source: officialSources.currentTerms,
    result: "missing_information",
    reasonCode: "RENT_OR_FEES_INCOMPLETE",
  }),
  createRuleCheck({
    ruleId: "RP-006",
    evaluatorId: "per_kwh_electricity_v1",
    source: officialSources.electricity,
    result: "missing_information",
    reasonCode: "SAME_PROPERTY_PERIOD_BILL_MISSING",
  }),
  createRuleCheck({
    ruleId: "RP-008",
    evaluatorId: "electricity_information_v1",
    source: officialSources.electricity,
    result: "missing_information",
    reasonCode: "ELECTRICITY_INFORMATION_MISSING",
  }),
  createRuleCheck({
    ruleId: "RP-009",
    evaluatorId: "repair_responsibility_v1",
    source: officialSources.currentTerms,
    result: "missing_information",
    reasonCode: "REPAIR_SCOPE_OR_CONTACT_MISSING",
  }),
  createRuleCheck({
    ruleId: "RP-010",
    evaluatorId: "rent_subsidy_restriction_v1",
    source: officialSources.subsidy,
    result: "possible_difference",
    reasonCode: "RENT_SUBSIDY_RESTRICTION_TEXT",
  }),
];

const p1AdditionalRuleChecks = [
  createRuleCheck({
    ruleId: "RP-001",
    evaluatorId: "review_period_v1",
    source: officialSources.currentTerms,
    result: "missing_information",
    reasonCode: "REVIEW_PERIOD_INFORMATION_MISSING",
  }),
  createRuleCheck({
    ruleId: "RP-002",
    evaluatorId: "advertisement_exclusion_v1",
    source: officialSources.currentTerms,
    result: "missing_information",
    reasonCode: "ADVERTISEMENT_EXCLUSION_INFORMATION_MISSING",
  }),
  createRuleCheck({
    ruleId: "RP-005",
    evaluatorId: "deposit_limit_and_return_v1",
    source: officialSources.currentTerms,
    result: "missing_information",
    reasonCode: "DEPOSIT_OR_RETURN_TERMS_MISSING",
  }),
  createRuleCheck({
    ruleId: "RP-007",
    evaluatorId: "non_metered_and_public_electricity_v1",
    source: officialSources.electricity,
    result: "missing_information",
    reasonCode: "NON_METERED_OR_PUBLIC_ELECTRICITY_INFORMATION_MISSING",
  }),
] satisfies readonly OfficialRuleCheck[];

export function getGoldenReportViewModel(
  ruleProfile: OfficialRuleProfile = "p0",
): PreSigningReport {
  const activeRuleChecks =
    ruleProfile === "p1" ? [...p0RuleChecks, ...p1AdditionalRuleChecks] : p0RuleChecks;
  return composePreSigningReport({
    provenance: {
      snapshotId: "snapshot-golden-000001",
      snapshotHash: "e7a7851a12d655782900eccb5e934298c47fd704bcc2e841a1561310711200c5",
      snapshotVersion: "synthetic-report-fixture.v1",
      manifestVersion: "golden-v1",
      manifestHash: "f3797356a1e3ea4bbed7a87802fdaaa001985557fb7b51845a9f6a4454157d7b",
      manifestSchema: "rentproof.demo-manifest.v1",
    },
    sourceLocators: [
      { refId: ids.listingLocator, locator: sources.listing },
      { refId: ids.contractLocator, locator: sources.contract },
      { refId: ids.viewingLocator, locator: sources.viewing },
      { refId: ids.paymentLocator, locator: sources.payment },
    ],
    findings: [
      claimFinding({
        id: ids.findingSupported,
        claimId: ids.claimSupported,
        status: "supported",
        locator: sources.listing,
      }),
      claimFinding({
        id: ids.findingContradicted,
        claimId: ids.claimContradicted,
        status: "contradicted",
        locator: sources.contract,
      }),
      claimFinding({
        id: ids.findingInsufficient,
        claimId: ids.claimInsufficient,
        status: "insufficient_evidence",
        locator: sources.viewing,
      }),
    ],
    ruleChecks: activeRuleChecks.map((check) => ({
      check,
      sourceRefIds: [ids.contractLocator],
    })),
    fraudSignals: [
      {
        signalId: "FRS-001",
        status: "detected",
        action: "stop_and_verify",
        reasonCode: "FRS_001_PAYMENT_BEFORE_VIEWING",
        sourceRefIds: [ids.paymentLocator],
        missingInputs: [],
        humanVerificationRequired: true,
      },
    ],
    nonNaturalDeathDisclosureStatements: [],
    costSummary: composeCostSummary([
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
        label: "押金（2 個月）",
        amount: { currency: "TWD", minorUnits: "24000" },
      },
    ]),
    costSourceCoverage: [
      { costId: "rent", sourceRefIds: [ids.listingLocator] },
      { costId: "electricity", sourceRefIds: [ids.contractLocator] },
      { costId: "deposit", sourceRefIds: [ids.contractLocator] },
    ],
  });
}
