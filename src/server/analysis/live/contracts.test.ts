import { describe, expect, it } from "vitest";
import { evaluateNonNaturalDeathDisclosure } from "@/domain/non-natural-death-disclosure";
import { P0_OFFICIAL_RULE_IDS } from "@/domain/official-rules";
import { PublicLiveAnalysisSnapshotSchema } from "./contracts";

function snapshot() {
  return {
    schemaVersion: "rentproof.live-analysis-snapshot.v1",
    snapshotId: "snapshot-live-contract-0001",
    caseVersion: "golden-v1",
    manifestHash: "a".repeat(64),
    executionMode: "live",
    providerCalled: true,
    ruleProfile: "p0",
    stageRuns: [
      "listing.extract",
      "evidence.extract",
      "contract.extract",
      "interaction.extract",
    ].map((stage) => ({
      stage,
      status: "succeeded",
      outputHash: "b".repeat(64),
      providerRequestId: `request-${stage}`,
      providerAttempts: 1,
      requestedModel: "gpt-5.6-terra",
      resolvedModel: "gpt-5.6-terra-2026-08-01",
      reasoningEffort: "medium",
      requestedServiceTier: "default",
      resolvedServiceTier: "default",
      promptVersion: "prompt.v1",
      schemaVersion: "rentproof.terra-analysis.v3",
      usage: { known: false },
    })),
    budget: {
      providerAttempts: 4,
      inputTokens: 0,
      outputAndReasoningTokens: 0,
      cachedInputTokens: 0,
      engineeringAlertReached: false,
      usageKnown: false,
    },
    configurationWarnings: ["OPENAI_PROJECT_LIMITS_UNVERIFIED"],
    findings: [],
    ruleChecks: P0_OFFICIAL_RULE_IDS.map((ruleId) => ({
      ruleId,
      result: "missing_information",
      reasonCode: "DETERMINISTIC_RULE_INPUT_INCOMPLETE",
      sourceRefs: ["source-contract-000001"],
    })),
    fraudSignals: [
      {
        signalId: "FRS-001",
        status: "detected",
        action: "stop_and_verify",
        reasonCode: "FRS_001_PAYMENT_BEFORE_VIEWING",
        sourceRefs: ["source-payment-0000001"],
      },
    ],
    nonNaturalDeathDisclosure: evaluateNonNaturalDeathDisclosure({ statements: [] }),
    nextActions: ["付款前完成查證。"],
    reportHref: "/reports/golden-v1",
  };
}

describe("PublicLiveAnalysisSnapshotSchema fraud signals", () => {
  it("accepts the current FRS-001-only live output", () => {
    expect(PublicLiveAnalysisSnapshotSchema.safeParse(snapshot()).success).toBe(true);
  });

  it("allows unique FRS-001 through FRS-010 results", () => {
    const value = snapshot();
    value.fraudSignals.push({
      signalId: "FRS-006",
      status: "detected",
      action: "verify_before_payment",
      reasonCode: "FRS_006_URGENT_SCARCITY_LANGUAGE",
      sourceRefs: ["source-pressure-0000001"],
    });
    expect(PublicLiveAnalysisSnapshotSchema.safeParse(value).success).toBe(true);
  });

  it("rejects duplicate signals and detected signals without a source", () => {
    const duplicate = snapshot();
    const duplicateSignal = duplicate.fraudSignals[0];
    if (duplicateSignal === undefined) throw new Error("test fixture missing fraud signal");
    duplicate.fraudSignals.push({ ...duplicateSignal });
    expect(PublicLiveAnalysisSnapshotSchema.safeParse(duplicate).success).toBe(false);

    const missingSource = snapshot();
    const sourceSignal = missingSource.fraudSignals[0];
    if (sourceSignal === undefined) throw new Error("test fixture missing fraud signal");
    missingSource.fraudSignals[0] = { ...sourceSignal, sourceRefs: [] };
    expect(PublicLiveAnalysisSnapshotSchema.safeParse(missingSource).success).toBe(false);
  });

  it("rejects signal status and action combinations that disagree", () => {
    const detectedReview = snapshot();
    const detectedSignal = detectedReview.fraudSignals[0];
    if (detectedSignal === undefined) throw new Error("test fixture missing fraud signal");
    detectedReview.fraudSignals[0] = { ...detectedSignal, action: "review" };
    expect(PublicLiveAnalysisSnapshotSchema.safeParse(detectedReview).success).toBe(false);

    const negativeStop = snapshot();
    const negativeSignal = negativeStop.fraudSignals[0];
    if (negativeSignal === undefined) throw new Error("test fixture missing fraud signal");
    negativeStop.fraudSignals[0] = {
      ...negativeSignal,
      status: "not_detected_in_provided_data",
      action: "stop_and_verify",
    };
    expect(PublicLiveAnalysisSnapshotSchema.safeParse(negativeStop).success).toBe(false);
  });
});
