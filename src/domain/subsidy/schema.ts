import { z } from "zod";

export const SubsidyPrecheckStatusSchema = z.enum([
  "preliminary_match",
  "needs_review",
  "insufficient_information",
]);

export const TaiwanCountyCitySchema = z.enum([
  "臺北市",
  "新北市",
  "桃園市",
  "臺中市",
  "臺南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "嘉義市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
]);

const TriStateSchema = z.enum(["yes", "no", "unknown"]);

export const SubsidyPrecheckInputSchema = z
  .object({
    applicationDate: z.union([z.iso.date(), z.literal("unknown")]),
    rentalCountyCity: TaiwanCountyCitySchema,
    nationalityAndRegistration: z.enum([
      "roc_national_with_domestic_household_registration",
      "other",
      "unknown",
    ]),
    ageBasis: z.enum(["adult", "listed_minor_exception", "other_minor", "unknown"]),
    householdHomeOwnership: z.enum([
      "no_self_owned_home",
      "shared_under_40_sqm_with_non_household_coowners",
      "announced_demolition_or_dangerous_building",
      "over_half_damaged_requires_repair",
      "other_self_owned_home",
      "unknown",
    ]),
    incomeThresholdBasis: z.enum(["standard", "newlywed_or_household_with_minor_child", "unknown"]),
    incomeComparedWithApplicableThreshold: z.enum(["below", "at_or_above", "unknown"]),
    otherHousingAssistance: z.enum([
      "none",
      "other_rent_subsidy_will_relinquish",
      "qualifying_social_housing_subsidy_will_relinquish",
      "assistance_received_only_by_non_applicant_household_member",
      "minor_student_dormitory_subsidy",
      "receiving_without_confirmed_exception",
      "unknown",
    ]),
    leaseTiming: z.enum([
      "started_or_starts_within_60_days_and_in_2026",
      "outside_allowed_timing",
      "unknown",
    ]),
    buildingBasis: z.enum([
      "qualifying_tax_registration_or_legal_building_proof",
      "same_address_114_carryover_exception",
      "not_confirmed_qualifying",
      "unknown",
    ]),
    applicantIsNamedLeaseholder: TriStateSchema,
    leaseIsGenuine: TriStateSchema,
    landlordOrOwnerIsHouseholdMemberOrLinealRelative: TriStateSchema,
    housingProgramType: z.enum([
      "ordinary_or_officially_allowed_exception",
      "disallowed_social_or_government_rental_housing",
      "unknown",
    ]),
    monthlyRentTwd: z.union([z.number().int().positive().max(100_000_000), z.literal("unknown")]),
    leaseUseIncludesResidence: TriStateSchema,
    is24HourCareInstitution: TriStateSchema,
  })
  .strict();

export const SubsidyPrecheckReasonCodeSchema = z.enum([
  "APPLICATION_DATE_WITHIN_115_WINDOW",
  "APPLICATION_DATE_UNKNOWN",
  "APPLICATION_DATE_OUTSIDE_115_WINDOW",
  "NATIONALITY_AND_REGISTRATION_MATCH_DECLARED",
  "NATIONALITY_AND_REGISTRATION_UNKNOWN",
  "NATIONALITY_AND_REGISTRATION_NEEDS_REVIEW",
  "AGE_BASIS_MATCH_DECLARED",
  "MINOR_EXCEPTION_NEEDS_AUTHORITY_REVIEW",
  "AGE_BASIS_UNKNOWN",
  "AGE_BASIS_NEEDS_REVIEW",
  "NO_SELF_OWNED_HOME_DECLARED",
  "HOME_OWNERSHIP_EXCEPTION_NEEDS_AUTHORITY_REVIEW",
  "HOME_OWNERSHIP_UNKNOWN",
  "OTHER_SELF_OWNED_HOME_DECLARED",
  "INCOME_BELOW_115_THRESHOLD",
  "INCOME_AT_OR_ABOVE_115_THRESHOLD",
  "INCOME_UNKNOWN",
  "INCOME_THRESHOLD_BASIS_UNKNOWN",
  "NO_OTHER_HOUSING_ASSISTANCE_DECLARED",
  "OTHER_ASSISTANCE_EXCEPTION_DECLARED",
  "OTHER_ASSISTANCE_UNKNOWN",
  "OTHER_ASSISTANCE_NEEDS_REVIEW",
  "LEASE_TIMING_MATCH_DECLARED",
  "LEASE_TIMING_UNKNOWN",
  "LEASE_TIMING_NEEDS_REVIEW",
  "BUILDING_BASIS_MATCH_DECLARED",
  "CARRYOVER_BUILDING_EXCEPTION_NEEDS_AUTHORITY_REVIEW",
  "BUILDING_BASIS_UNKNOWN",
  "BUILDING_BASIS_NEEDS_REVIEW",
  "APPLICANT_IS_NAMED_LEASEHOLDER",
  "APPLICANT_LEASEHOLDER_STATE_UNKNOWN",
  "APPLICANT_NOT_NAMED_LEASEHOLDER",
  "LEASE_GENUINE_DECLARED",
  "LEASE_GENUINENESS_UNKNOWN",
  "LEASE_GENUINENESS_NEEDS_REVIEW",
  "NO_PROHIBITED_LANDLORD_RELATIONSHIP_DECLARED",
  "LANDLORD_RELATIONSHIP_UNKNOWN",
  "PROHIBITED_LANDLORD_RELATIONSHIP_DECLARED",
  "HOUSING_PROGRAM_TYPE_MATCH_DECLARED",
  "HOUSING_PROGRAM_TYPE_UNKNOWN",
  "HOUSING_PROGRAM_TYPE_NEEDS_REVIEW",
  "MONTHLY_RENT_WITHIN_115_CAP",
  "MONTHLY_RENT_EXCEEDS_115_CAP",
  "MONTHLY_RENT_UNKNOWN",
  "RESIDENTIAL_USE_DECLARED",
  "LEASE_USE_UNKNOWN",
  "RESIDENTIAL_USE_NOT_DECLARED",
  "NOT_24_HOUR_CARE_INSTITUTION_DECLARED",
  "CARE_INSTITUTION_STATE_UNKNOWN",
  "IS_24_HOUR_CARE_INSTITUTION_DECLARED",
]);

export const SubsidyPrecheckCheckSchema = z
  .object({
    criterion: z.enum([
      "application_window",
      "nationality_and_registration",
      "age_basis",
      "home_ownership",
      "income",
      "other_housing_assistance",
      "lease_timing",
      "building_basis",
      "named_leaseholder",
      "lease_genuineness",
      "landlord_relationship",
      "housing_program_type",
      "monthly_rent_cap",
      "residential_use",
      "care_institution",
    ]),
    status: SubsidyPrecheckStatusSchema,
    reasonCode: SubsidyPrecheckReasonCodeSchema,
    officialQuestionReference: z.string().trim().min(1).max(80),
    thresholdTwd: z.number().int().positive().optional(),
  })
  .strict();

export const SubsidyOfficialSourceSchema = z
  .object({
    sourceId: z.enum(["MOI_115_CONDITIONS", "MOI_115_FAQ"]),
    title: z.string().trim().min(1).max(160),
    publisher: z.literal("內政部不動產資訊平台"),
    url: z.url().refine((url) => url.startsWith("https://pip.moi.gov.tw/")),
    verifiedAt: z.literal("2026-09-04"),
    snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

export const SubsidyPrecheckResultSchema = z
  .object({
    schema: z.literal("rentproof.rental-subsidy-precheck.v1"),
    program: z.literal("115年度300億元中央擴大租金補貼"),
    programYear: z.literal(115),
    rulesVersion: z.literal("115.2026-09-04.1"),
    scope: z.literal("declared_applicant_and_rental_conditions_precheck"),
    overallStatus: SubsidyPrecheckStatusSchema,
    checks: z.array(SubsidyPrecheckCheckSchema).length(15),
    officialSources: z.tuple([SubsidyOfficialSourceSchema, SubsidyOfficialSourceSchema]),
    officialDeterminationRequired: z.literal(true),
    humanReviewRequired: z.literal(true),
    sensitiveDocumentsRequested: z.literal(false),
    disclaimerCode: z.literal("PRECHECK_NOT_OFFICIAL_ELIGIBILITY_DETERMINATION"),
  })
  .strict();

export type SubsidyPrecheckInput = z.infer<typeof SubsidyPrecheckInputSchema>;
export type SubsidyPrecheckCheck = z.infer<typeof SubsidyPrecheckCheckSchema>;
export type SubsidyPrecheckResult = z.infer<typeof SubsidyPrecheckResultSchema>;
export type TaiwanCountyCity = z.infer<typeof TaiwanCountyCitySchema>;
