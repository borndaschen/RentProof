import { describe, expect, it } from "vitest";
import { ConversationIntentResultSchema, MaterialCandidatePayloadSchema } from ".";

describe("ConversationIntentResultSchema", () => {
  it("accepts a bounded read-only intent", () => {
    expect(
      ConversationIntentResultSchema.parse({
        kind: "read_only_intent",
        intent: "show_case_summary",
        workspaceArea: "summary",
        focusRefIds: [],
      }).kind,
    ).toBe("read_only_intent");
  });

  it("rejects stage control and unknown keys", () => {
    expect(
      ConversationIntentResultSchema.safeParse({
        kind: "read_only_intent",
        intent: "run_stage",
        workspaceArea: null,
        focusRefIds: [],
        confirmed: true,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate candidate fields", () => {
    expect(
      MaterialCandidatePayloadSchema.safeParse({
        candidateType: "update_case_profile",
        changes: [
          { field: "residential_lease", value: { status: "known", value: "yes" } },
          { field: "residential_lease", value: { status: "unknown" } },
        ],
      }).success,
    ).toBe(false);
  });
});
