import { describe, expect, it } from "vitest";
import { canonicalizeCandidatePayload } from "./canonical-payload";

describe("canonicalizeCandidatePayload", () => {
  it("produces the same digest regardless of object property insertion order", () => {
    const first = canonicalizeCandidatePayload({
      candidateType: "update_case_profile",
      changes: [
        {
          field: "electricity_payer",
          value: { status: "known", value: "tenant" },
        },
      ],
    });
    const second = canonicalizeCandidatePayload({
      changes: [
        {
          value: { value: "tenant", status: "known" },
          field: "electricity_payer",
        },
      ],
      candidateType: "update_case_profile",
    });

    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("preserves array order in the binding", () => {
    const first = canonicalizeCandidatePayload({
      candidateType: "update_case_profile",
      changes: [
        { field: "residential_lease", value: { status: "known", value: "yes" } },
        { field: "intended_lease_months", value: { status: "known", value: 12 } },
      ],
    });
    const reversed = canonicalizeCandidatePayload({
      candidateType: "update_case_profile",
      changes: [...first.payload.changes].reverse(),
    });

    expect(first.sha256).not.toBe(reversed.sha256);
  });

  it("only hashes validated typed candidates, never raw conversation text", () => {
    expect(() =>
      canonicalizeCandidatePayload({
        candidateType: "update_case_profile",
        changes: [{ field: "residential_lease", value: { status: "known", value: "yes" } }],
        rawConversationText: "do not retain or hash this",
      }),
    ).toThrow();

    expect(() => canonicalizeCandidatePayload("raw conversation text")).toThrow();
  });
});
