import { describe, expect, it } from "vitest";
import { AssistantTurnSchema } from ".";

const id = "abcdefghijklmnopqrstuvwx";

describe("AssistantTurnSchema", () => {
  const base = {
    schemaVersion: "rentproof.assistant-turn.v1",
    turnId: id,
    caseRevision: 1,
    snapshotId: id,
    segments: [{ kind: "server_message", templateKey: "next_step", text: "下一步" }],
    cards: [],
    remainingItemCount: 0,
    workspaceAction: null,
  } as const;

  it("accepts a bounded assistant turn", () => {
    expect(AssistantTurnSchema.safeParse(base).success).toBe(true);
  });

  it("rejects more than 600 code points", () => {
    const value = { ...base, segments: [{ ...base.segments[0], text: "界".repeat(601) }] };
    expect(AssistantTurnSchema.safeParse(value).success).toBe(false);
  });

  it("requires a workspace action when items remain", () => {
    expect(AssistantTurnSchema.safeParse({ ...base, remainingItemCount: 2 }).success).toBe(false);
  });
});
