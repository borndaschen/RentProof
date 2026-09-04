import {
  SubsidyPrecheckInputSchema,
  SubsidyPrecheckResultSchema,
  type SubsidyPrecheckCheck,
  type SubsidyPrecheckInput,
  type SubsidyPrecheckResult,
} from "./schema";
import { SUBSIDY_SOURCE_SNAPSHOT_HASHES } from "./source-governance";
import { subsidyThresholdsFor115 } from "./thresholds";

const officialSources = [
  {
    sourceId: "MOI_115_CONDITIONS",
    title: "115年度300億元中央擴大租金補貼－申請條件",
    publisher: "內政部不動產資訊平台",
    url: "https://pip.moi.gov.tw/Publicize/Info/B1020?n=%E7%94%B3%E8%AB%8B%E6%A2%9D%E4%BB%B6&y=115",
    verifiedAt: "2026-09-04",
    snapshotSha256: SUBSIDY_SOURCE_SNAPSHOT_HASHES.MOI_115_CONDITIONS,
  },
  {
    sourceId: "MOI_115_FAQ",
    title: "115年度300億元中央擴大租金補貼－問與答",
    publisher: "內政部不動產資訊平台",
    url: "https://pip.moi.gov.tw/Publicize/Info/B1020?n=%E5%95%8F%E8%88%87%E7%AD%94&y=115",
    verifiedAt: "2026-09-04",
    snapshotSha256: SUBSIDY_SOURCE_SNAPSHOT_HASHES.MOI_115_FAQ,
  },
] as const;

function check(
  criterion: SubsidyPrecheckCheck["criterion"],
  status: SubsidyPrecheckCheck["status"],
  reasonCode: SubsidyPrecheckCheck["reasonCode"],
  officialQuestionReference: string,
  thresholdTwd?: number,
): SubsidyPrecheckCheck {
  return {
    criterion,
    status,
    reasonCode,
    officialQuestionReference,
    ...(thresholdTwd === undefined ? {} : { thresholdTwd }),
  };
}

function triStateCheck(args: {
  criterion: SubsidyPrecheckCheck["criterion"];
  value: "yes" | "no" | "unknown";
  matchValue: "yes" | "no";
  matchReason: SubsidyPrecheckCheck["reasonCode"];
  unknownReason: SubsidyPrecheckCheck["reasonCode"];
  reviewReason: SubsidyPrecheckCheck["reasonCode"];
  reference: string;
}): SubsidyPrecheckCheck {
  if (args.value === "unknown") {
    return check(args.criterion, "insufficient_information", args.unknownReason, args.reference);
  }
  if (args.value === args.matchValue) {
    return check(args.criterion, "preliminary_match", args.matchReason, args.reference);
  }
  return check(args.criterion, "needs_review", args.reviewReason, args.reference);
}

function evaluateIncome(
  input: SubsidyPrecheckInput,
  thresholds: ReturnType<typeof subsidyThresholdsFor115>,
): SubsidyPrecheckCheck {
  const comparison = input.incomeComparedWithApplicableThreshold;
  if (comparison === "unknown") {
    return check(
      "income",
      "insufficient_information",
      "INCOME_UNKNOWN",
      "申請條件表2／問與答第十四題",
    );
  }
  if (input.incomeThresholdBasis === "unknown") {
    return check(
      "income",
      "insufficient_information",
      "INCOME_THRESHOLD_BASIS_UNKNOWN",
      "申請條件表2／問與答第十四題",
      thresholds.enhancedIncome,
    );
  }
  const threshold =
    input.incomeThresholdBasis === "standard"
      ? thresholds.standardIncome
      : thresholds.enhancedIncome;
  return comparison === "below"
    ? check(
        "income",
        "preliminary_match",
        "INCOME_BELOW_115_THRESHOLD",
        "申請條件表2／問與答第十四題",
        threshold,
      )
    : check(
        "income",
        "needs_review",
        "INCOME_AT_OR_ABOVE_115_THRESHOLD",
        "申請條件表2／問與答第十四題",
        threshold,
      );
}

export function evaluateRentalSubsidyPrecheck115(input: unknown): SubsidyPrecheckResult {
  const parsed = SubsidyPrecheckInputSchema.parse(input);
  const thresholds = subsidyThresholdsFor115(parsed.rentalCountyCity);
  const checks: SubsidyPrecheckCheck[] = [];

  checks.push(
    parsed.applicationDate === "unknown"
      ? check(
          "application_window",
          "insufficient_information",
          "APPLICATION_DATE_UNKNOWN",
          "問與答第三題",
        )
      : parsed.applicationDate >= "2026-01-01" && parsed.applicationDate <= "2026-12-31"
        ? check(
            "application_window",
            "preliminary_match",
            "APPLICATION_DATE_WITHIN_115_WINDOW",
            "問與答第三題",
          )
        : check(
            "application_window",
            "needs_review",
            "APPLICATION_DATE_OUTSIDE_115_WINDOW",
            "問與答第三題",
          ),
  );

  checks.push(
    parsed.nationalityAndRegistration === "unknown"
      ? check(
          "nationality_and_registration",
          "insufficient_information",
          "NATIONALITY_AND_REGISTRATION_UNKNOWN",
          "問與答第六題（一）",
        )
      : parsed.nationalityAndRegistration === "roc_national_with_domestic_household_registration"
        ? check(
            "nationality_and_registration",
            "preliminary_match",
            "NATIONALITY_AND_REGISTRATION_MATCH_DECLARED",
            "問與答第六題（一）",
          )
        : check(
            "nationality_and_registration",
            "needs_review",
            "NATIONALITY_AND_REGISTRATION_NEEDS_REVIEW",
            "問與答第六題（一）",
          ),
  );

  checks.push(
    parsed.ageBasis === "unknown"
      ? check("age_basis", "insufficient_information", "AGE_BASIS_UNKNOWN", "問與答第六題（一）")
      : parsed.ageBasis === "adult"
        ? check("age_basis", "preliminary_match", "AGE_BASIS_MATCH_DECLARED", "問與答第六題（一）")
        : parsed.ageBasis === "listed_minor_exception"
          ? check(
              "age_basis",
              "needs_review",
              "MINOR_EXCEPTION_NEEDS_AUTHORITY_REVIEW",
              "問與答第六題（一）",
            )
          : check("age_basis", "needs_review", "AGE_BASIS_NEEDS_REVIEW", "問與答第六題（一）"),
  );

  checks.push(
    parsed.householdHomeOwnership === "unknown"
      ? check(
          "home_ownership",
          "insufficient_information",
          "HOME_OWNERSHIP_UNKNOWN",
          "申請條件表1／問與答第六題（二）",
        )
      : parsed.householdHomeOwnership === "no_self_owned_home"
        ? check(
            "home_ownership",
            "preliminary_match",
            "NO_SELF_OWNED_HOME_DECLARED",
            "申請條件表1／問與答第六題（二）",
          )
        : parsed.householdHomeOwnership === "other_self_owned_home"
          ? check(
              "home_ownership",
              "needs_review",
              "OTHER_SELF_OWNED_HOME_DECLARED",
              "申請條件表1／問與答第六題（二）",
            )
          : check(
              "home_ownership",
              "needs_review",
              "HOME_OWNERSHIP_EXCEPTION_NEEDS_AUTHORITY_REVIEW",
              "申請條件表1／問與答第六題（二）",
            ),
  );
  checks.push(evaluateIncome(parsed, thresholds));

  checks.push(
    parsed.otherHousingAssistance === "unknown"
      ? check(
          "other_housing_assistance",
          "insufficient_information",
          "OTHER_ASSISTANCE_UNKNOWN",
          "問與答第十五題",
        )
      : parsed.otherHousingAssistance === "none"
        ? check(
            "other_housing_assistance",
            "preliminary_match",
            "NO_OTHER_HOUSING_ASSISTANCE_DECLARED",
            "問與答第十五題",
          )
        : parsed.otherHousingAssistance === "receiving_without_confirmed_exception"
          ? check(
              "other_housing_assistance",
              "needs_review",
              "OTHER_ASSISTANCE_NEEDS_REVIEW",
              "問與答第十五題",
            )
          : check(
              "other_housing_assistance",
              "needs_review",
              "OTHER_ASSISTANCE_EXCEPTION_DECLARED",
              "問與答第十五題",
            ),
  );

  checks.push(
    parsed.leaseTiming === "unknown"
      ? check(
          "lease_timing",
          "insufficient_information",
          "LEASE_TIMING_UNKNOWN",
          "問與答第七題（二）",
        )
      : parsed.leaseTiming === "started_or_starts_within_60_days_and_in_2026"
        ? check(
            "lease_timing",
            "preliminary_match",
            "LEASE_TIMING_MATCH_DECLARED",
            "問與答第七題（二）",
          )
        : check("lease_timing", "needs_review", "LEASE_TIMING_NEEDS_REVIEW", "問與答第七題（二）"),
  );

  checks.push(
    parsed.buildingBasis === "unknown"
      ? check(
          "building_basis",
          "insufficient_information",
          "BUILDING_BASIS_UNKNOWN",
          "問與答第十六至十七題",
        )
      : parsed.buildingBasis === "qualifying_tax_registration_or_legal_building_proof"
        ? check(
            "building_basis",
            "preliminary_match",
            "BUILDING_BASIS_MATCH_DECLARED",
            "問與答第十六至十七題",
          )
        : parsed.buildingBasis === "same_address_114_carryover_exception"
          ? check(
              "building_basis",
              "needs_review",
              "CARRYOVER_BUILDING_EXCEPTION_NEEDS_AUTHORITY_REVIEW",
              "問與答第十六至十七題",
            )
          : check(
              "building_basis",
              "needs_review",
              "BUILDING_BASIS_NEEDS_REVIEW",
              "問與答第十六至十七題",
            ),
  );

  checks.push(
    triStateCheck({
      criterion: "named_leaseholder",
      value: parsed.applicantIsNamedLeaseholder,
      matchValue: "yes",
      matchReason: "APPLICANT_IS_NAMED_LEASEHOLDER",
      unknownReason: "APPLICANT_LEASEHOLDER_STATE_UNKNOWN",
      reviewReason: "APPLICANT_NOT_NAMED_LEASEHOLDER",
      reference: "問與答第十六題（二）",
    }),
    triStateCheck({
      criterion: "lease_genuineness",
      value: parsed.leaseIsGenuine,
      matchValue: "yes",
      matchReason: "LEASE_GENUINE_DECLARED",
      unknownReason: "LEASE_GENUINENESS_UNKNOWN",
      reviewReason: "LEASE_GENUINENESS_NEEDS_REVIEW",
      reference: "問與答第十六題（三）",
    }),
    triStateCheck({
      criterion: "landlord_relationship",
      value: parsed.landlordOrOwnerIsHouseholdMemberOrLinealRelative,
      matchValue: "no",
      matchReason: "NO_PROHIBITED_LANDLORD_RELATIONSHIP_DECLARED",
      unknownReason: "LANDLORD_RELATIONSHIP_UNKNOWN",
      reviewReason: "PROHIBITED_LANDLORD_RELATIONSHIP_DECLARED",
      reference: "問與答第十六題（四）",
    }),
  );

  checks.push(
    parsed.housingProgramType === "unknown"
      ? check(
          "housing_program_type",
          "insufficient_information",
          "HOUSING_PROGRAM_TYPE_UNKNOWN",
          "問與答第十六題（五）",
        )
      : parsed.housingProgramType === "ordinary_or_officially_allowed_exception"
        ? check(
            "housing_program_type",
            "preliminary_match",
            "HOUSING_PROGRAM_TYPE_MATCH_DECLARED",
            "問與答第十六題（五）",
          )
        : check(
            "housing_program_type",
            "needs_review",
            "HOUSING_PROGRAM_TYPE_NEEDS_REVIEW",
            "問與答第十六題（五）",
          ),
  );

  checks.push(
    parsed.monthlyRentTwd === "unknown"
      ? check(
          "monthly_rent_cap",
          "insufficient_information",
          "MONTHLY_RENT_UNKNOWN",
          "問與答第十六題表5",
          thresholds.monthlyRent,
        )
      : parsed.monthlyRentTwd <= thresholds.monthlyRent
        ? check(
            "monthly_rent_cap",
            "preliminary_match",
            "MONTHLY_RENT_WITHIN_115_CAP",
            "問與答第十六題表5",
            thresholds.monthlyRent,
          )
        : check(
            "monthly_rent_cap",
            "needs_review",
            "MONTHLY_RENT_EXCEEDS_115_CAP",
            "問與答第十六題表5",
            thresholds.monthlyRent,
          ),
    triStateCheck({
      criterion: "residential_use",
      value: parsed.leaseUseIncludesResidence,
      matchValue: "yes",
      matchReason: "RESIDENTIAL_USE_DECLARED",
      unknownReason: "LEASE_USE_UNKNOWN",
      reviewReason: "RESIDENTIAL_USE_NOT_DECLARED",
      reference: "問與答第十六題（七）",
    }),
    triStateCheck({
      criterion: "care_institution",
      value: parsed.is24HourCareInstitution,
      matchValue: "no",
      matchReason: "NOT_24_HOUR_CARE_INSTITUTION_DECLARED",
      unknownReason: "CARE_INSTITUTION_STATE_UNKNOWN",
      reviewReason: "IS_24_HOUR_CARE_INSTITUTION_DECLARED",
      reference: "問與答第十六題（八）",
    }),
  );

  const overallStatus = checks.some((item) => item.status === "needs_review")
    ? "needs_review"
    : checks.some((item) => item.status === "insufficient_information")
      ? "insufficient_information"
      : "preliminary_match";

  return SubsidyPrecheckResultSchema.parse({
    schema: "rentproof.rental-subsidy-precheck.v1",
    program: "115年度300億元中央擴大租金補貼",
    programYear: 115,
    rulesVersion: "115.2026-09-04.1",
    scope: "declared_applicant_and_rental_conditions_precheck",
    overallStatus,
    checks,
    officialSources,
    officialDeterminationRequired: true,
    humanReviewRequired: true,
    sensitiveDocumentsRequested: false,
    disclaimerCode: "PRECHECK_NOT_OFFICIAL_ELIGIBILITY_DETERMINATION",
  });
}
