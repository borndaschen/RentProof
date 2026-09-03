import { describe, expect, it } from "vitest";
import { ActionCardDraftSchema, composeActionCards, type ActionCardDraft } from "./action-card";

function draft(
  actionId: string,
  reasonClass: ActionCardDraft["reasonClass"],
  actionType: ActionCardDraft["actionType"],
): ActionCardDraft {
  return {
    actionId,
    actionType,
    reasonClass,
    target: { kind: "finding", refId: "finding-ref-00000001" },
    sourceRefs: ["locator-ref-00000001"],
    completionConditions: ["written_answer_recorded"],
    reasonCode: "REPORT_ACTION_REQUIRED",
  };
}

describe("composeActionCards", () => {
  it("uses deterministic server priority and action id tie breaking", () => {
    const result = composeActionCards([
      draft("missing", "missing_verification_information", "attach"),
      draft("insufficient-b", "insufficient_evidence", "photograph"),
      draft("payment", "payment_verification", "verify"),
      draft("difference", "official_rule_possible_difference", "modify"),
      draft("contradiction", "explicit_contradiction", "ask"),
      draft("insufficient-a", "insufficient_evidence", "attach"),
    ]);

    expect(result.map((action) => action.actionId)).toEqual([
      "payment",
      "contradiction",
      "difference",
      "missing",
      "insufficient-a",
      "insufficient-b",
    ]);
    expect(result.map((action) => action.priority)).toEqual([0, 10, 20, 25, 30, 30]);
  });

  it("requires target, source refs, and completion conditions and rejects unknown keys", () => {
    expect(
      ActionCardDraftSchema.safeParse(draft("valid", "explicit_contradiction", "ask")).success,
    ).toBe(true);
    expect(
      ActionCardDraftSchema.safeParse({
        ...draft("invalid", "explicit_contradiction", "ask"),
        sourceRefs: [],
      }).success,
    ).toBe(false);
    expect(
      ActionCardDraftSchema.safeParse({
        ...draft("invalid", "explicit_contradiction", "ask"),
        extra: true,
      }).success,
    ).toBe(false);
  });
});
