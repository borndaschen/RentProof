import { describe, expect, it } from "vitest";
import { evaluateRentalSubsidyPrecheck115 } from "./evaluator";
import { SubsidyPrecheckInputSchema } from "./schema";
import { subsidyThresholdsFor115 } from "./thresholds";

const matchingInput = {
  applicationDate: "2026-06-30",
  rentalCountyCity: "臺北市",
  nationalityAndRegistration: "roc_national_with_domestic_household_registration",
  ageBasis: "adult",
  householdHomeOwnership: "no_self_owned_home",
  incomeThresholdBasis: "standard",
  incomeComparedWithApplicableThreshold: "below",
  otherHousingAssistance: "none",
  leaseTiming: "started_or_starts_within_60_days_and_in_2026",
  buildingBasis: "qualifying_tax_registration_or_legal_building_proof",
  applicantIsNamedLeaseholder: "yes",
  leaseIsGenuine: "yes",
  landlordOrOwnerIsHouseholdMemberOrLinealRelative: "no",
  housingProgramType: "ordinary_or_officially_allowed_exception",
  monthlyRentTwd: 20_000,
  leaseUseIncludesResidence: "yes",
  is24HourCareInstitution: "no",
} as const;

function findCheck(
  result: ReturnType<typeof evaluateRentalSubsidyPrecheck115>,
  criterion: (typeof result.checks)[number]["criterion"],
) {
  const found = result.checks.find((item) => item.criterion === criterion);
  if (found === undefined) throw new Error(`Missing check: ${criterion}`);
  return found;
}

describe("evaluateRentalSubsidyPrecheck115", () => {
  it("returns only a preliminary match for complete self-declared matching inputs", () => {
    const result = evaluateRentalSubsidyPrecheck115(matchingInput);
    expect(result).toMatchObject({
      schema: "rentproof.rental-subsidy-precheck.v1",
      programYear: 115,
      rulesVersion: "115.2026-09-04.1",
      overallStatus: "preliminary_match",
      officialDeterminationRequired: true,
      humanReviewRequired: true,
      sensitiveDocumentsRequested: false,
      disclaimerCode: "PRECHECK_NOT_OFFICIAL_ELIGIBILITY_DETERMINATION",
    });
    expect(result.checks).toHaveLength(15);
    expect(result.checks.every((item) => item.status === "preliminary_match")).toBe(true);
    expect(result.officialSources.map((source) => source.sourceId)).toEqual([
      "MOI_115_CONDITIONS",
      "MOI_115_FAQ",
    ]);
  });

  it.each([
    ["applicationDate", "unknown", "application_window", "APPLICATION_DATE_UNKNOWN"],
    [
      "nationalityAndRegistration",
      "unknown",
      "nationality_and_registration",
      "NATIONALITY_AND_REGISTRATION_UNKNOWN",
    ],
    ["ageBasis", "unknown", "age_basis", "AGE_BASIS_UNKNOWN"],
    ["householdHomeOwnership", "unknown", "home_ownership", "HOME_OWNERSHIP_UNKNOWN"],
    ["incomeComparedWithApplicableThreshold", "unknown", "income", "INCOME_UNKNOWN"],
    ["otherHousingAssistance", "unknown", "other_housing_assistance", "OTHER_ASSISTANCE_UNKNOWN"],
    ["leaseTiming", "unknown", "lease_timing", "LEASE_TIMING_UNKNOWN"],
    ["buildingBasis", "unknown", "building_basis", "BUILDING_BASIS_UNKNOWN"],
    [
      "applicantIsNamedLeaseholder",
      "unknown",
      "named_leaseholder",
      "APPLICANT_LEASEHOLDER_STATE_UNKNOWN",
    ],
    ["leaseIsGenuine", "unknown", "lease_genuineness", "LEASE_GENUINENESS_UNKNOWN"],
    [
      "landlordOrOwnerIsHouseholdMemberOrLinealRelative",
      "unknown",
      "landlord_relationship",
      "LANDLORD_RELATIONSHIP_UNKNOWN",
    ],
    ["housingProgramType", "unknown", "housing_program_type", "HOUSING_PROGRAM_TYPE_UNKNOWN"],
    ["monthlyRentTwd", "unknown", "monthly_rent_cap", "MONTHLY_RENT_UNKNOWN"],
    ["leaseUseIncludesResidence", "unknown", "residential_use", "LEASE_USE_UNKNOWN"],
    ["is24HourCareInstitution", "unknown", "care_institution", "CARE_INSTITUTION_STATE_UNKNOWN"],
  ] as const)(
    "maps unknown %s to insufficient information",
    (field, value, criterion, reasonCode) => {
      const result = evaluateRentalSubsidyPrecheck115({ ...matchingInput, [field]: value });
      expect(findCheck(result, criterion)).toMatchObject({
        status: "insufficient_information",
        reasonCode,
      });
      expect(result.overallStatus).toBe("insufficient_information");
    },
  );

  it.each([
    ["applicationDate", "2027-01-01", "application_window", "APPLICATION_DATE_OUTSIDE_115_WINDOW"],
    [
      "nationalityAndRegistration",
      "other",
      "nationality_and_registration",
      "NATIONALITY_AND_REGISTRATION_NEEDS_REVIEW",
    ],
    ["ageBasis", "other_minor", "age_basis", "AGE_BASIS_NEEDS_REVIEW"],
    [
      "householdHomeOwnership",
      "other_self_owned_home",
      "home_ownership",
      "OTHER_SELF_OWNED_HOME_DECLARED",
    ],
    [
      "otherHousingAssistance",
      "receiving_without_confirmed_exception",
      "other_housing_assistance",
      "OTHER_ASSISTANCE_NEEDS_REVIEW",
    ],
    ["leaseTiming", "outside_allowed_timing", "lease_timing", "LEASE_TIMING_NEEDS_REVIEW"],
    ["buildingBasis", "not_confirmed_qualifying", "building_basis", "BUILDING_BASIS_NEEDS_REVIEW"],
    ["applicantIsNamedLeaseholder", "no", "named_leaseholder", "APPLICANT_NOT_NAMED_LEASEHOLDER"],
    ["leaseIsGenuine", "no", "lease_genuineness", "LEASE_GENUINENESS_NEEDS_REVIEW"],
    [
      "landlordOrOwnerIsHouseholdMemberOrLinealRelative",
      "yes",
      "landlord_relationship",
      "PROHIBITED_LANDLORD_RELATIONSHIP_DECLARED",
    ],
    [
      "housingProgramType",
      "disallowed_social_or_government_rental_housing",
      "housing_program_type",
      "HOUSING_PROGRAM_TYPE_NEEDS_REVIEW",
    ],
    ["monthlyRentTwd", 55_001, "monthly_rent_cap", "MONTHLY_RENT_EXCEEDS_115_CAP"],
    ["leaseUseIncludesResidence", "no", "residential_use", "RESIDENTIAL_USE_NOT_DECLARED"],
    ["is24HourCareInstitution", "yes", "care_institution", "IS_24_HOUR_CARE_INSTITUTION_DECLARED"],
  ] as const)(
    "maps declared review case %s to needs review",
    (field, value, criterion, reasonCode) => {
      const result = evaluateRentalSubsidyPrecheck115({ ...matchingInput, [field]: value });
      expect(findCheck(result, criterion)).toMatchObject({ status: "needs_review", reasonCode });
      expect(result.overallStatus).toBe("needs_review");
    },
  );

  it.each([
    ["listed_minor_exception", "age_basis", "MINOR_EXCEPTION_NEEDS_AUTHORITY_REVIEW"],
  ] as const)(
    "keeps listed minor exceptions for authority review",
    (value, criterion, reasonCode) => {
      const result = evaluateRentalSubsidyPrecheck115({ ...matchingInput, ageBasis: value });
      expect(findCheck(result, criterion)).toMatchObject({ status: "needs_review", reasonCode });
    },
  );

  it.each([
    "shared_under_40_sqm_with_non_household_coowners",
    "announced_demolition_or_dangerous_building",
    "over_half_damaged_requires_repair",
  ] as const)("never self-approves the home ownership exception %s", (householdHomeOwnership) => {
    const result = evaluateRentalSubsidyPrecheck115({ ...matchingInput, householdHomeOwnership });
    expect(findCheck(result, "home_ownership")).toMatchObject({
      status: "needs_review",
      reasonCode: "HOME_OWNERSHIP_EXCEPTION_NEEDS_AUTHORITY_REVIEW",
    });
  });

  it.each([
    "other_rent_subsidy_will_relinquish",
    "qualifying_social_housing_subsidy_will_relinquish",
    "assistance_received_only_by_non_applicant_household_member",
    "minor_student_dormitory_subsidy",
  ] as const)("never self-approves the other-assistance exception %s", (otherHousingAssistance) => {
    const result = evaluateRentalSubsidyPrecheck115({ ...matchingInput, otherHousingAssistance });
    expect(findCheck(result, "other_housing_assistance")).toMatchObject({
      status: "needs_review",
      reasonCode: "OTHER_ASSISTANCE_EXCEPTION_DECLARED",
    });
  });

  it("keeps the 114 same-address building carryover exception for authority review", () => {
    const result = evaluateRentalSubsidyPrecheck115({
      ...matchingInput,
      buildingBasis: "same_address_114_carryover_exception",
    });
    expect(findCheck(result, "building_basis")).toMatchObject({
      status: "needs_review",
      reasonCode: "CARRYOVER_BUILDING_EXCEPTION_NEEDS_AUTHORITY_REVIEW",
    });
  });

  it.each([
    ["臺北市", 61_137, 71_327, 55_000],
    ["新北市", 50_700, 59_150, 45_000],
    ["桃園市", 50_304, 58_688, 45_000],
    ["臺中市", 48_231, 56_270, 45_000],
    ["臺南市", 46_545, 54_303, 40_000],
    ["高雄市", 48_120, 56_140, 40_000],
    ["新竹市", 46_545, 54_303, 45_000],
    ["新竹縣", 46_545, 54_303, 45_000],
    ["金門縣", 43_023, 50_194, 39_000],
    ["連江縣", 43_023, 50_194, 39_000],
    ["基隆市", 46_545, 54_303, 39_000],
    ["嘉義市", 46_545, 54_303, 39_000],
    ["苗栗縣", 46_545, 54_303, 39_000],
    ["彰化縣", 46_545, 54_303, 39_000],
    ["南投縣", 46_545, 54_303, 39_000],
    ["雲林縣", 46_545, 54_303, 39_000],
    ["嘉義縣", 46_545, 54_303, 39_000],
    ["屏東縣", 46_545, 54_303, 39_000],
    ["宜蘭縣", 46_545, 54_303, 39_000],
    ["花蓮縣", 46_545, 54_303, 39_000],
    ["臺東縣", 46_545, 54_303, 39_000],
    ["澎湖縣", 46_545, 54_303, 39_000],
  ] as const)("uses official 115 thresholds for %s", (county, standard, enhanced, rent) => {
    expect(subsidyThresholdsFor115(county)).toEqual({
      standardIncome: standard,
      enhancedIncome: enhanced,
      monthlyRent: rent,
    });
  });

  it("uses the self-attested comparison against the displayed threshold and inclusive rent caps", () => {
    const standardAtBoundary = evaluateRentalSubsidyPrecheck115({
      ...matchingInput,
      incomeComparedWithApplicableThreshold: "at_or_above",
      monthlyRentTwd: 55_000,
    });
    expect(findCheck(standardAtBoundary, "income")).toMatchObject({
      status: "needs_review",
      thresholdTwd: 61_137,
    });
    expect(findCheck(standardAtBoundary, "monthly_rent_cap")).toMatchObject({
      status: "preliminary_match",
      thresholdTwd: 55_000,
    });

    const enhancedBelowBoundary = evaluateRentalSubsidyPrecheck115({
      ...matchingInput,
      incomeThresholdBasis: "newlywed_or_household_with_minor_child",
      incomeComparedWithApplicableThreshold: "below",
    });
    expect(findCheck(enhancedBelowBoundary, "income")).toMatchObject({
      status: "preliminary_match",
      thresholdTwd: 71_327,
    });
  });

  it.each(["2026-01-01", "2026-12-31"] as const)(
    "includes the official application-window boundary %s",
    (applicationDate) => {
      expect(
        findCheck(
          evaluateRentalSubsidyPrecheck115({ ...matchingInput, applicationDate }),
          "application_window",
        ),
      ).toMatchObject({
        status: "preliminary_match",
        reasonCode: "APPLICATION_DATE_WITHIN_115_WINDOW",
      });
    },
  );

  it("requires the threshold basis before applying the user's income comparison", () => {
    const unknownBasis = evaluateRentalSubsidyPrecheck115({
      ...matchingInput,
      incomeThresholdBasis: "unknown",
      incomeComparedWithApplicableThreshold: "below",
    });
    expect(findCheck(unknownBasis, "income")).toMatchObject({
      status: "insufficient_information",
      reasonCode: "INCOME_THRESHOLD_BASIS_UNKNOWN",
      thresholdTwd: 71_327,
    });
  });

  it("gives needs review precedence when unknown and review facts coexist", () => {
    const result = evaluateRentalSubsidyPrecheck115({
      ...matchingInput,
      ageBasis: "unknown",
      applicantIsNamedLeaseholder: "no",
    });
    expect(result.overallStatus).toBe("needs_review");
  });

  it("rejects unknown keys, malformed dates, non-integer money, and out-of-range values", () => {
    expect(
      SubsidyPrecheckInputSchema.safeParse({ ...matchingInput, unexpected: true }).success,
    ).toBe(false);
    expect(
      SubsidyPrecheckInputSchema.safeParse({ ...matchingInput, applicationDate: "115-01-01" })
        .success,
    ).toBe(false);
    expect(
      SubsidyPrecheckInputSchema.safeParse({ ...matchingInput, monthlyRentTwd: 12_000.5 }).success,
    ).toBe(false);
    expect(
      SubsidyPrecheckInputSchema.safeParse({
        ...matchingInput,
        incomeComparedWithApplicableThreshold: 1,
      }).success,
    ).toBe(false);
    expect(
      SubsidyPrecheckInputSchema.safeParse({
        ...matchingInput,
        averageMonthlyIncomePerHouseholdMemberTwd: 30_000,
      }).success,
    ).toBe(false);
    expect(
      SubsidyPrecheckInputSchema.safeParse({ ...matchingInput, rentalCountyCity: "其他" }).success,
    ).toBe(false);
  });

  it("does not emit a final eligibility, legal, probability, or document-upload verdict", () => {
    const serialized = JSON.stringify(evaluateRentalSubsidyPrecheck115(matchingInput));
    expect(serialized).not.toMatch(
      /eligible|ineligible|approved|denied|legal|illegal|probability|score|upload|身分證|戶籍謄本|所得證明/iu,
    );
  });
});
