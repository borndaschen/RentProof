import { z } from "zod";

const FIRST_FUTURE_ROC_YEAR = 116;

export type SubsidyYearUpdateCode =
  "SUBSIDY_YEAR_GREGORIAN_INVALID" | "SUBSIDY_YEAR_MAPPING_INVALID" | "SUBSIDY_YEAR_ROC_INVALID";

export class SubsidyYearUpdateError extends Error {
  readonly code: SubsidyYearUpdateCode;

  constructor(code: SubsidyYearUpdateCode) {
    super(code);
    this.name = "SubsidyYearUpdateError";
    this.code = code;
  }
}

export const SubsidyYearDraftSchema = z
  .object({
    schemaVersion: z.literal("rentproof.rental-subsidy-year-draft.v1"),
    rocYear: z.number().int().min(FIRST_FUTURE_ROC_YEAR).max(999),
    gregorianYear: z.number().int().min(2027).max(2910),
    status: z.literal("source_review_required"),
    productionReady: z.literal(false),
    copiedFromPriorYear: z.literal(false),
    blockers: z.tuple([
      z.literal("OFFICIAL_PROGRAM_NOT_VERIFIED"),
      z.literal("OFFICIAL_SOURCE_SNAPSHOTS_NOT_FROZEN"),
      z.literal("THRESHOLDS_AND_RULES_NOT_REVIEWED"),
      z.literal("LEGAL_PRIVACY_AND_GOVERNANCE_REVIEW_NOT_COMPLETE"),
    ]),
    officialSources: z.array(z.never()).length(0),
    thresholds: z.null(),
    rules: z.array(z.never()).length(0),
  })
  .strict();

export type SubsidyYearDraft = z.infer<typeof SubsidyYearDraftSchema>;

export function createSubsidyYearDraft(input: {
  rocYear: number;
  gregorianYear: number;
}): SubsidyYearDraft {
  if (
    !Number.isSafeInteger(input.rocYear) ||
    input.rocYear < FIRST_FUTURE_ROC_YEAR ||
    input.rocYear > 999
  ) {
    throw new SubsidyYearUpdateError("SUBSIDY_YEAR_ROC_INVALID");
  }
  if (
    !Number.isSafeInteger(input.gregorianYear) ||
    input.gregorianYear < 2027 ||
    input.gregorianYear > 2910
  ) {
    throw new SubsidyYearUpdateError("SUBSIDY_YEAR_GREGORIAN_INVALID");
  }
  if (input.gregorianYear !== input.rocYear + 1911) {
    throw new SubsidyYearUpdateError("SUBSIDY_YEAR_MAPPING_INVALID");
  }
  return SubsidyYearDraftSchema.parse({
    schemaVersion: "rentproof.rental-subsidy-year-draft.v1",
    rocYear: input.rocYear,
    gregorianYear: input.gregorianYear,
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
}
