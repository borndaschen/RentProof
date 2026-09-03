import { InMemoryEvidenceBudgetRepository } from "@/application/analysis-budget";
import type { PrivateUploadRecord } from "@/server/uploads/contracts";
import { describe, expect, it } from "vitest";
import { OpenAIAnalysisError } from "@/adapters/openai/analysis/adapter";
import type {
  AnalysisProviderReasonCode,
  TerraAnalysisInput,
  TerraAnalysisOutput,
  TerraAnalysisSuccess,
} from "@/adapters/openai/analysis/contracts";
import { LIVE_TERRA_STAGE_ORDER } from "./contracts";
import {
  InMemoryLiveSnapshotRepository,
  LiveAnalysisService,
  type TerraAnalyzer,
} from "./live-analysis-service";

const caseId = "golden-v1" as const;
const artifactIds = {
  listing: "listing-synthetic-listing-png",
  viewing: "viewing-view-10-jpg",
  contract: "contract-synthetic-lease-pdf",
  interaction: "interaction-payment-request-json",
};

function locator(type: "image" | "pdf" | "text", artifactId: string, suffix: string) {
  const locatorId = `locator_${suffix}_000000000001`;
  if (type === "image") {
    return {
      type,
      locatorId,
      artifactId,
      bbox: [0.1, 0.1, 0.9, 0.9] as [number, number, number, number],
    };
  }
  if (type === "pdf") {
    return {
      type,
      locatorId,
      artifactId,
      page: 1,
      start: 0,
      end: 10,
      excerpt: "虛構契約文字",
    } as const;
  }
  return { type, locatorId, artifactId, start: 0, end: 10, excerpt: "看屋前先付款" } as const;
}

const outputs: Record<(typeof LIVE_TERRA_STAGE_ORDER)[number], TerraAnalysisOutput> = {
  "listing.extract": {
    stage: "listing.extract",
    claims: [
      {
        id: "claim_washer_0000000001",
        caseId,
        artifactId: artifactIds.listing,
        source: "listing",
        category: "equipment",
        key: "washing_machine",
        rawText: "附洗衣機",
        normalizedValue: { type: "boolean", value: true },
        modelConfidence: 0.95,
        qualityFlags: [],
        locator: locator("image", artifactIds.listing, "listing"),
      },
      {
        id: "claim_rent_00000000001",
        caseId,
        artifactId: artifactIds.listing,
        source: "listing",
        category: "rent",
        key: "monthly_rent",
        rawText: "月租一萬二千元",
        normalizedValue: { type: "money", amountMinor: 12000, currency: "TWD", period: "month" },
        modelConfidence: 0.95,
        qualityFlags: [],
        locator: locator("image", artifactIds.listing, "rent"),
      },
      {
        id: "claim_electricity_0001",
        caseId,
        artifactId: artifactIds.listing,
        source: "listing",
        category: "fee",
        key: "electricity_unit_rate",
        rawText: "電費每度五元",
        normalizedValue: {
          type: "unit_rate",
          amountMinorPerUnit: 5,
          currency: "TWD",
          unit: "kwh",
        },
        modelConfidence: 0.95,
        qualityFlags: [],
        locator: locator("image", artifactIds.listing, "electricity"),
      },
      {
        id: "claim_deposit_000000001",
        caseId,
        artifactId: artifactIds.listing,
        source: "listing",
        category: "fee",
        key: "deposit_amount",
        rawText: "押金兩個月",
        normalizedValue: { type: "text", value: "two_months" },
        modelConfidence: 0.95,
        qualityFlags: [],
        locator: locator("image", artifactIds.listing, "deposit"),
      },
    ],
  },
  "evidence.extract": {
    stage: "evidence.extract",
    observations: [
      {
        id: "observation_washer_00001",
        caseId,
        artifactId: artifactIds.viewing,
        key: "washing_machine",
        description: "照片未呈現洗衣機位置",
        presence: "not_shown",
        observedValue: null,
        modelConfidence: 0.9,
        qualityFlags: [],
        uncertaintyReason: null,
        locator: locator("image", artifactIds.viewing, "viewing"),
      },
    ],
  },
  "contract.extract": {
    stage: "contract.extract",
    clauses: [
      {
        id: "clause_subsidy_00000001",
        caseId,
        artifactId: artifactIds.contract,
        semanticKey: "rent_subsidy",
        rawText: "不得申請租金補貼",
        normalizedValue: { type: "boolean", value: false },
        modelConfidence: 0.96,
        qualityFlags: [],
        locator: locator("pdf", artifactIds.contract, "contract"),
      },
      {
        id: "clause_rent_0000000001",
        caseId,
        artifactId: artifactIds.contract,
        semanticKey: "monthly_rent",
        rawText: "每月租金新臺幣一萬二千元",
        normalizedValue: { type: "money", amountMinor: 12000, currency: "TWD", period: "month" },
        modelConfidence: 0.96,
        qualityFlags: [],
        locator: locator("pdf", artifactIds.contract, "rent_contract"),
      },
      {
        id: "clause_electricity_0001",
        caseId,
        artifactId: artifactIds.contract,
        semanticKey: "electricity_unit_rate",
        rawText: "電費每度六元",
        normalizedValue: {
          type: "unit_rate",
          amountMinorPerUnit: 6,
          currency: "TWD",
          unit: "kwh",
        },
        modelConfidence: 0.96,
        qualityFlags: [],
        locator: locator("pdf", artifactIds.contract, "electricity_contract"),
      },
      {
        id: "clause_deposit_0000001",
        caseId,
        artifactId: artifactIds.contract,
        semanticKey: "deposit_amount",
        rawText: "押金新臺幣二萬四千元",
        normalizedValue: {
          type: "money",
          amountMinor: 24000,
          currency: "TWD",
          period: "one_time",
        },
        modelConfidence: 0.96,
        qualityFlags: [],
        locator: locator("pdf", artifactIds.contract, "deposit_contract"),
      },
    ],
    nonNaturalDeathDisclosureStatements: [
      {
        statementId: "disclosure_live_000000001",
        subjectScope: "exclusive_area",
        period: "during_owner_holding",
        answer: "no",
        eventTypes: [],
        sourceKind: "contract_clause",
        signedByProvider: false,
        locator: locator("pdf", artifactIds.contract, "disclosure_contract"),
      },
    ],
  },
  "interaction.extract": {
    stage: "interaction.extract",
    paymentRequestCues: [
      {
        id: "payment_cue_0000000001",
        caseId,
        artifactId: artifactIds.interaction,
        requestedItem: "reservation_fee",
        amountMinor: 3000,
        rawExcerpt: "看屋前先付三千元",
        locator: locator("text", artifactIds.interaction, "payment"),
      },
    ],
  },
};

class FakeAnalyzer implements TerraAnalyzer {
  readonly calls: string[] = [];
  readonly inputs: TerraAnalysisInput[] = [];

  constructor(
    private readonly failure?: { stage: string; code: AnalysisProviderReasonCode },
    private readonly knownUsage = true,
  ) {}

  analyze(raw: unknown): Promise<TerraAnalysisSuccess> {
    const input = raw as TerraAnalysisInput;
    this.calls.push(input.stage);
    this.inputs.push(input);
    if (this.failure?.stage === input.stage) {
      throw new OpenAIAnalysisError(this.failure.code, 1, `response_${input.stage}`);
    }
    return Promise.resolve({
      output: outputs[input.stage],
      sourceLocators: [],
      provenance: {
        provider: "openai",
        endpoint: "responses.parse",
        stage: input.stage,
        requestedModel: "gpt-5.6-terra",
        resolvedModel: "gpt-5.6-terra",
        reasoningEffort: "medium",
        requestedServiceTier: "default",
        resolvedServiceTier: "default",
        promptVersion: `${input.stage}.prompt.v1`,
        schemaVersion: "rentproof.terra-analysis.v2",
        providerRequestId: `response_${input.stage}`,
        providerAttempts: 1,
        usage: this.knownUsage
          ? {
              known: true,
              inputTokens: 100,
              cachedInputTokens: 10,
              outputTokens: 20,
              reasoningTokens: 5,
              totalTokens: 125,
            }
          : { known: false },
      },
    });
  }
}

function receipts(): PrivateUploadRecord[] {
  return [
    {
      receipt: {
        schemaVersion: "rentproof.synthetic-upload-receipt.v1",
        receiptId: "receipt_listing_000000001",
        kind: "listing",
        originalSha256: "a".repeat(64),
        derivativeSha256: "b".repeat(64),
        media: { type: "image", mime: "image/png", width: 100, height: 100 },
      },
      artifactId: artifactIds.listing,
      caseId,
      originalByteLength: 4,
      privatePayload: { type: "image", derivativeBytes: Uint8Array.from([1, 2, 3, 4]) },
    },
    {
      receipt: {
        schemaVersion: "rentproof.synthetic-upload-receipt.v1",
        receiptId: "receipt_viewing_000000001",
        kind: "viewing",
        originalSha256: "c".repeat(64),
        derivativeSha256: "d".repeat(64),
        media: { type: "image", mime: "image/jpeg", width: 100, height: 100 },
      },
      artifactId: artifactIds.viewing,
      caseId,
      originalByteLength: 4,
      privatePayload: { type: "image", derivativeBytes: Uint8Array.from([5, 6, 7, 8]) },
    },
    {
      receipt: {
        schemaVersion: "rentproof.synthetic-upload-receipt.v1",
        receiptId: "receipt_contract_00000001",
        kind: "contract",
        originalSha256: "e".repeat(64),
        derivativeSha256: null,
        media: { type: "pdf", mime: "application/pdf", pageCount: 1, characterCount: 8 },
      },
      artifactId: artifactIds.contract,
      caseId,
      originalByteLength: 8,
      privatePayload: {
        type: "pdf",
        extracted: {
          pageCount: 1,
          characterCount: 8,
          pages: [{ page: 1, text: "虛構租約內容", segments: [] }],
        },
      },
    },
  ];
}

function interaction() {
  return {
    artifactId: artifactIds.interaction,
    text: "若要保留順位，請在看屋前先付款。",
    paymentRequestedAt: "2026-09-04T20:00:00+08:00",
    firstInPersonViewingAt: "2026-09-05T14:00:00+08:00",
  };
}

function harness(analyzer: FakeAnalyzer) {
  const snapshots = new InMemoryLiveSnapshotRepository();
  let sequence = 0;
  const service = new LiveAnalysisService({
    analyzer,
    budget: new InMemoryEvidenceBudgetRepository({ now: () => new Date("2026-09-03T00:00:00Z") }),
    snapshots,
    nextId: () => `reservation_live_${String(++sequence).padStart(8, "0")}`,
  });
  return { service, snapshots };
}

describe("LiveAnalysisService", () => {
  it("runs the fixed four-stage Terra DAG then commits deterministic findings, rules, fraud, and provenance", async () => {
    const analyzer = new FakeAnalyzer();
    const { service, snapshots } = harness(analyzer);
    const result = await service.run({
      caseId,
      manifestHash: "f".repeat(64),
      receipts: receipts(),
      interaction: interaction(),
    });

    expect(result.ok).toBe(true);
    expect(analyzer.calls).toEqual(LIVE_TERRA_STAGE_ORDER);
    expect(analyzer.inputs.every((input) => /^[A-Za-z0-9_-]{20,128}$/u.test(input.caseId))).toBe(
      true,
    );
    const evidenceInput = analyzer.inputs.find((input) => input.stage === "evidence.extract");
    expect(
      evidenceInput?.stage === "evidence.extract" ? evidenceInput.images[0]?.artifactId : null,
    ).toBe("artifact_viewing-view-10-jpg_0001");
    if (!result.ok) throw new Error(result.code);
    expect(result.snapshot.stageRuns.map((run) => run.stage)).toEqual(LIVE_TERRA_STAGE_ORDER);
    expect(result.snapshot.budget).toMatchObject({
      providerAttempts: 4,
      inputTokens: 400,
      outputAndReasoningTokens: 100,
      usageKnown: true,
    });
    expect(result.snapshot.findings[0]?.status).toBe("insufficient_evidence");
    expect(
      result.snapshot.findings.find((finding) => finding.claimId === "claim_rent_00000000001")
        ?.status,
    ).toBe("supported");
    expect(
      result.snapshot.findings.find((finding) => finding.claimId === "claim_electricity_0001")
        ?.status,
    ).toBe("contradicted");
    expect(
      result.snapshot.findings.find((finding) => finding.claimId === "claim_deposit_000000001")
        ?.status,
    ).toBe("insufficient_evidence");
    expect(result.snapshot.ruleChecks.find((check) => check.ruleId === "RP-010")?.result).toBe(
      "possible_difference",
    );
    expect(result.snapshot.fraudSignals[0]?.status).toBe("detected");
    expect(result.snapshot.nonNaturalDeathDisclosure.checks).toMatchObject([
      { period: "during_owner_holding", status: "supported", disclosedAnswer: "no" },
      {
        period: "before_owner_holding_known",
        status: "insufficient_evidence",
        disclosedAnswer: "unknown",
      },
    ]);
    expect(result.snapshot.configurationWarnings).toEqual(["OPENAI_PROJECT_LIMITS_UNVERIFIED"]);
    expect(snapshots.get(caseId)).toEqual(result.snapshot);
    expect(JSON.stringify(result.snapshot)).not.toContain("C:\\");
    expect(JSON.stringify(result.snapshot)).not.toContain("OPENAI_API_KEY");
  });

  it.each([
    "ANALYSIS_PROVIDER_REFUSED",
    "ANALYSIS_PROVIDER_INCOMPLETE",
    "ANALYSIS_PROVIDER_SCHEMA_INVALID",
    "ANALYSIS_PROVIDER_AUTH_FAILED",
    "ANALYSIS_PROVIDER_RATE_LIMITED",
    "ANALYSIS_LOCATOR_INVALID",
  ] as const)("keeps %s distinct and never commits a snapshot", async (code) => {
    const analyzer = new FakeAnalyzer({ stage: "evidence.extract", code });
    const { service, snapshots } = harness(analyzer);
    await expect(
      service.run({
        caseId,
        manifestHash: "f".repeat(64),
        receipts: receipts(),
        interaction: interaction(),
      }),
    ).resolves.toEqual({ ok: false, code });
    expect(analyzer.calls).toEqual(["listing.extract", "evidence.extract"]);
    expect(snapshots.get(caseId)).toBeNull();
  });

  it("fails closed on unknown usage before another provider request and does not commit", async () => {
    const analyzer = new FakeAnalyzer(undefined, false);
    const { service, snapshots } = harness(analyzer);
    await expect(
      service.run({
        caseId,
        manifestHash: "f".repeat(64),
        receipts: receipts(),
        interaction: interaction(),
      }),
    ).resolves.toEqual({ ok: false, code: "ANALYSIS_BUDGET_USAGE_UNKNOWN" });
    expect(analyzer.calls).toEqual(["listing.extract"]);
    expect(snapshots.get(caseId)).toBeNull();
  });
});
