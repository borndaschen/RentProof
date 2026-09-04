import { describe, expect, it } from "vitest";
import { parseHistoryDetailResponse, parseHistoryResponse } from "./history-client-parser";

const summary = {
  caseId: "case_owner_scoped_00000001",
  displayName: "南京東路套房",
  status: "ready",
  updatedAt: "2026-09-03T00:00:00.000Z",
} as const;

describe("history client response parser", () => {
  it("accepts the exact list and detail projections", () => {
    expect(
      parseHistoryResponse({ schemaVersion: "rentproof.case-history.v1", cases: [summary] }),
    ).toEqual([summary]);
    expect(
      parseHistoryDetailResponse({
        schemaVersion: "rentproof.case-history-detail.v1",
        case: {
          ...summary,
          revision: 3,
          sourceMode: "fixture",
          createdAt: "2026-09-02T00:00:00+08:00",
        },
      }),
    ).toMatchObject({ caseId: summary.caseId, revision: 3 });
  });

  it.each([
    { schemaVersion: "rentproof.case-history.v1", cases: [{ ...summary, leaked: true }] },
    { schemaVersion: "rentproof.case-history.v1", cases: [{ ...summary, caseId: "short" }] },
    { schemaVersion: "rentproof.case-history.v1", cases: [{ ...summary, updatedAt: "tomorrow" }] },
  ])("fails closed for an invalid list projection %#", (value) => {
    expect(parseHistoryResponse(value)).toBeNull();
  });

  it("rejects extra detail fields and unsafe revisions", () => {
    const detail = {
      ...summary,
      revision: 0,
      sourceMode: "live",
      createdAt: "2026-09-02T00:00:00.000Z",
    };
    expect(
      parseHistoryDetailResponse({
        schemaVersion: "rentproof.case-history-detail.v1",
        case: { ...detail, ownerEmail: "private@example.test" },
      }),
    ).toBeNull();
    expect(
      parseHistoryDetailResponse({
        schemaVersion: "rentproof.case-history-detail.v1",
        case: { ...detail, revision: -1 },
      }),
    ).toBeNull();
  });
});
