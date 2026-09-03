import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmptySingleCase } from "@/application/case-commands";
import { projectVerifiedSyntheticConversationState } from "./verified-synthetic-state";

const snapshot = {
  schemaVersion: "rentproof.fixture-analysis-snapshot.v1",
  snapshotId: "snapshot_fixture_abcdefghijklmnop",
  caseVersion: "golden-v1",
  manifestHash: "a".repeat(64),
  executionMode: "fixture",
  providerCalled: false,
  findings: [
    {
      claimId: "claim_fixture_000000001",
      status: "insufficient_evidence",
      sourceRefs: ["source_fixture_00000001"],
    },
  ],
  nextActions: ["補拍設備位置。"],
  reportHref: "/reports/golden-v1",
} as const;

function aggregate() {
  return createEmptySingleCase({
    caseId: "demo_case_golden_v1_01",
    owner: {
      kind: "guest",
      guestId: "fixture_guest_actor_0001",
      guestSessionId: "fixture_guest_session_01",
    },
  });
}

describe("verified synthetic conversation state projection", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses sealed snapshot identity and does not invent known case fields", () => {
    expect(
      projectVerifiedSyntheticConversationState({
        sealedSnapshot: snapshot,
        caseAggregate: aggregate(),
      }),
    ).toMatchObject({
      casePhase: "report_ready",
      caseRevision: 0,
      snapshotId: snapshot.snapshotId,
      executionMode: "live",
      knownFields: {
        residentialLease: false,
        intendedLeaseMonths: false,
        plannedSigningDate: false,
        electricityPayer: false,
        paymentRequestedAt: false,
        firstInPersonViewingAt: false,
      },
    });
  });

  it("projects only presence booleans after a typed, confirmed aggregate change", () => {
    const state = aggregate();
    const changed = {
      ...state,
      revision: 2,
      caseProfile: {
        ...state.caseProfile,
        electricityPayer: { status: "known" as const, value: "tenant" as const },
      },
      fraudTimeline: {
        ...state.fraudTimeline,
        paymentRequestedAt: {
          status: "known" as const,
          value: "2026-09-03T08:00:00+08:00",
        },
      },
    };
    const projected = projectVerifiedSyntheticConversationState({
      sealedSnapshot: snapshot,
      caseAggregate: changed,
    });
    expect(projected.caseRevision).toBe(2);
    expect(projected.knownFields).toEqual({
      residentialLease: false,
      intendedLeaseMonths: false,
      plannedSigningDate: false,
      electricityPayer: true,
      paymentRequestedAt: true,
      firstInPersonViewingAt: false,
    });
    expect(JSON.stringify(projected)).not.toContain("tenant");
    expect(JSON.stringify(projected)).not.toContain("2026-09-03T08:00:00");
  });

  it("rejects unsealed/provider-backed or schema-invalid source objects", () => {
    expect(() =>
      projectVerifiedSyntheticConversationState({
        sealedSnapshot: { ...snapshot, providerCalled: true },
        caseAggregate: aggregate(),
      }),
    ).toThrow();
    expect(() =>
      projectVerifiedSyntheticConversationState({
        sealedSnapshot: { ...snapshot, unknown: "field" },
        caseAggregate: aggregate(),
      }),
    ).toThrow();
  });
});
