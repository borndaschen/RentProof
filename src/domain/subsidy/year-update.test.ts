import { describe, expect, it } from "vitest";
import {
  SubsidyYearDraftSchema,
  SubsidyYearUpdateError,
  createSubsidyYearDraft,
} from "./year-update";

describe("future subsidy year scaffold", () => {
  it("creates an empty fail-closed 116/2027 draft without prior-year values", () => {
    expect(createSubsidyYearDraft({ rocYear: 116, gregorianYear: 2027 })).toEqual({
      schemaVersion: "rentproof.rental-subsidy-year-draft.v1",
      rocYear: 116,
      gregorianYear: 2027,
      status: "source_review_required",
      productionReady: false,
      copiedFromPriorYear: false,
      blockers: [
        "OFFICIAL_PROGRAM_NOT_VERIFIED",
        "OFFICIAL_SOURCE_SNAPSHOTS_NOT_FROZEN",
        "THRESHOLDS_AND_RULES_NOT_REVIEWED",
        "LEGAL_PRIVACY_AND_GOVERNANCE_REVIEW_NOT_COMPLETE",
      ],
      officialSources: [],
      thresholds: null,
      rules: [],
    });
  });

  it.each([
    [{ rocYear: 116, gregorianYear: 2026 }, "SUBSIDY_YEAR_GREGORIAN_INVALID"],
    [{ rocYear: 117, gregorianYear: 2027 }, "SUBSIDY_YEAR_MAPPING_INVALID"],
    [{ rocYear: 115, gregorianYear: 2026 }, "SUBSIDY_YEAR_ROC_INVALID"],
    [{ rocYear: 116.5, gregorianYear: 2027 }, "SUBSIDY_YEAR_ROC_INVALID"],
    [{ rocYear: Number.NaN, gregorianYear: 2027 }, "SUBSIDY_YEAR_ROC_INVALID"],
    [{ rocYear: 116, gregorianYear: Number.POSITIVE_INFINITY }, "SUBSIDY_YEAR_GREGORIAN_INVALID"],
  ] as const)("rejects invalid or non-future year input %#", (input, code) => {
    expect(() => createSubsidyYearDraft(input)).toThrowError(
      expect.objectContaining<Partial<SubsidyYearUpdateError>>({ code }),
    );
  });

  it("rejects populated or production-ready drafts", () => {
    const draft = createSubsidyYearDraft({ rocYear: 116, gregorianYear: 2027 });
    expect(SubsidyYearDraftSchema.safeParse({ ...draft, productionReady: true }).success).toBe(
      false,
    );
    expect(SubsidyYearDraftSchema.safeParse({ ...draft, rules: [{ id: "copied" }] }).success).toBe(
      false,
    );
  });
});
