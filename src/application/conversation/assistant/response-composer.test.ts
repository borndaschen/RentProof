import { describe, expect, it } from "vitest";
import { HybridAssistantResponseComposer } from "./response-composer";

const turnId = "turn_abcdefghijklmnopqrstu";
const snapshotId = "snapshot_abcdefghijklmnop";
const otherSnapshotId = "snapshot_zyxwvutsrqponmlk";
const sourceRefId = "source_abcdefghijklmnopqr";

function card(
  suffix: string,
  priorityClass:
    | "blocking_security"
    | "stop_and_verify"
    | "pending_confirmation"
    | "current_next_step"
    | "evidence",
  overrides: Record<string, unknown> = {},
) {
  return {
    cardId: `card_${suffix.padEnd(20, "x")}`,
    focusRefId: null,
    snapshotId,
    priorityClass,
    cardType: "finding",
    title: suffix,
    description: `description ${suffix}`,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    turnId,
    caseRevision: 3,
    snapshotId,
    serverTemplateKeys: ["next_step"],
    explanationSegments: [
      {
        text: "廣告與契約記載的電費單價不同。",
        grounding: { kind: "source_refs", sourceRefIds: [sourceRefId] },
      },
    ],
    serverCards: [],
    availableSourceRefs: [{ sourceRefId, snapshotId }],
    remainingWorkspaceArea: "evidence_matrix",
    ...overrides,
  };
}

describe("HybridAssistantResponseComposer", () => {
  it("combines fixed server templates with source-bound AI explanations", () => {
    const result = new HybridAssistantResponseComposer().compose(input());
    expect(result).toMatchObject({
      ok: true,
      turn: {
        segments: [
          {
            kind: "server_message",
            templateKey: "next_step",
            text: "請依目前案件狀態完成下一步；需要修改資料時，系統會先顯示確認卡。",
          },
          {
            kind: "ai_explanation",
            grounding: { kind: "source_refs", sourceRefIds: [sourceRefId] },
          },
        ],
      },
    });
  });

  it("normalizes AI narrative to NFC", () => {
    const result = new HybridAssistantResponseComposer().compose(
      input({
        serverTemplateKeys: [],
        explanationSegments: [
          {
            text: "e\u0301",
            grounding: {
              kind: "insufficient_information",
              reasonCode: "EXPLANATION_FACTS_INSUFFICIENT",
            },
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      turn: { segments: [{ kind: "ai_explanation", text: "é" }] },
    });
  });

  it("allows an explicit insufficient-information explanation without source refs", () => {
    const result = new HybridAssistantResponseComposer().compose(
      input({
        snapshotId: null,
        serverTemplateKeys: [],
        availableSourceRefs: [],
        explanationSegments: [
          {
            text: "目前沒有足夠資料說明這一項。",
            grounding: {
              kind: "insufficient_information",
              reasonCode: "EXPLANATION_LOCATOR_UNAVAILABLE",
            },
          },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it.each([
    "這個條款違法。",
    "這可能是詐騙。",
    "詐騙機率為八成。",
    "可以放心簽約。",
    "房東應負責賠償。",
    "責任歸屬已經確定。",
    "請立即匯款。",
    "建議補拍牆面。",
    "點擊確認按鈕。",
  ])("rejects forbidden legal, fraud, safety, responsibility, or action wording: %s", (text) => {
    expect(
      new HybridAssistantResponseComposer().compose(
        input({
          serverTemplateKeys: [],
          explanationSegments: [
            {
              text,
              grounding: {
                kind: "insufficient_information",
                reasonCode: "EXPLANATION_FACTS_INSUFFICIENT",
              },
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "EXPLANATION_FORBIDDEN_PHRASE" });
  });

  it("rejects unknown, cross-snapshot, and null-snapshot source refs", () => {
    const composer = new HybridAssistantResponseComposer();
    expect(composer.compose(input({ availableSourceRefs: [] }))).toEqual({
      ok: false,
      code: "EXPLANATION_SOURCE_INVALID",
    });
    expect(
      composer.compose(
        input({ availableSourceRefs: [{ sourceRefId, snapshotId: otherSnapshotId }] }),
      ),
    ).toEqual({ ok: false, code: "EXPLANATION_SOURCE_INVALID" });
    expect(composer.compose(input({ snapshotId: null }))).toEqual({
      ok: false,
      code: "EXPLANATION_SOURCE_INVALID",
    });
  });

  it("rejects cards from another snapshot", () => {
    expect(
      new HybridAssistantResponseComposer().compose(
        input({
          serverCards: [card("foreign", "evidence", { snapshotId: otherSnapshotId })],
        }),
      ),
    ).toEqual({ ok: false, code: "EXPLANATION_SOURCE_INVALID" });
  });

  it("sorts cards deterministically, shows three, and links remaining items", () => {
    const result = new HybridAssistantResponseComposer().compose(
      input({
        serverCards: [
          card("evidence", "evidence"),
          card("next", "current_next_step"),
          card("blocking", "blocking_security"),
          card("verify", "stop_and_verify"),
          card("confirmation", "pending_confirmation"),
        ],
      }),
    );
    if (!result.ok) {
      throw new Error(result.code);
    }
    expect(result.turn.cards.map((item) => item.priorityClass)).toEqual([
      "blocking_security",
      "stop_and_verify",
      "pending_confirmation",
    ]);
    expect(result.turn.remainingItemCount).toBe(2);
    expect(result.turn.workspaceAction).toEqual({
      area: "evidence_matrix",
      labelKey: "view_evidence_workspace",
    });
  });

  it("preserves input order within the same priority class", () => {
    const result = new HybridAssistantResponseComposer().compose(
      input({
        serverCards: [card("first", "evidence"), card("second", "evidence")],
      }),
    );
    if (!result.ok) {
      throw new Error(result.code);
    }
    expect(
      result.turn.cards.map((item) =>
        item.cardType === "candidate_confirmation" ? item.cardType : item.title,
      ),
    ).toEqual(["first", "second"]);
  });

  it("fails rather than truncating narrative beyond 600 code points", () => {
    expect(
      new HybridAssistantResponseComposer().compose(
        input({
          serverTemplateKeys: [],
          explanationSegments: [
            {
              text: "界".repeat(601),
              grounding: {
                kind: "insufficient_information",
                reasonCode: "EXPLANATION_FACTS_INSUFFICIENT",
              },
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "ASSISTANT_OUTPUT_SCHEMA_INVALID" });
  });

  it("rejects unknown fields, duplicate cards, and more than six total segments", () => {
    const composer = new HybridAssistantResponseComposer();
    expect(composer.compose(input({ aiCards: [] }))).toEqual({
      ok: false,
      code: "ASSISTANT_OUTPUT_SCHEMA_INVALID",
    });
    const repeated = card("duplicate", "evidence");
    expect(composer.compose(input({ serverCards: [repeated, repeated] }))).toEqual({
      ok: false,
      code: "ASSISTANT_OUTPUT_SCHEMA_INVALID",
    });
    expect(
      composer.compose(
        input({
          serverTemplateKeys: [
            "next_step",
            "clarification",
            "validation_error",
            "provider_error",
            "insufficient_information",
            "http_warning",
          ],
        }),
      ),
    ).toEqual({ ok: false, code: "ASSISTANT_OUTPUT_SCHEMA_INVALID" });
  });
});
