import type {
  ExtendedFraudEvaluationInput,
  ExtendedFraudSignalId,
  FraudAction,
  FraudSignalCheck,
  LocatedCandidate,
} from "./contracts";

type CandidateRule<T> = Readonly<{
  signalId: ExtendedFraudSignalId;
  candidate: LocatedCandidate<T>;
  detected: (value: T) => boolean;
  action: Exclude<FraudAction, "review">;
  detectedReason: string;
  notDetectedReason: string;
  missingInput: string;
  minimumLocatorCount?: number;
}>;

function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs.filter((ref) => ref.trim().length > 0))];
}

function result(
  signalId: ExtendedFraudSignalId,
  status: FraudSignalCheck["status"],
  action: FraudAction,
  reasonCode: string,
  evidenceRefs: readonly string[],
  missingInputs: readonly string[],
): FraudSignalCheck {
  const refs = uniqueRefs(evidenceRefs);
  if (status === "detected" && refs.length === 0) {
    return {
      signalId,
      status: "insufficient_information",
      action: "review",
      reasonCode: `${signalId.replace("-", "_")}_LOCATOR_REQUIRED`,
      evidenceRefs: [],
      missingInputs: ["located_evidence"],
      humanVerificationRequired: true,
    };
  }
  return {
    signalId,
    status,
    action,
    reasonCode,
    evidenceRefs: refs,
    missingInputs,
    humanVerificationRequired: true,
  };
}

function evaluateCandidate<T>(rule: CandidateRule<T>): FraudSignalCheck {
  if (rule.candidate.status === "unknown") {
    return result(
      rule.signalId,
      "insufficient_information",
      "review",
      `${rule.signalId.replace("-", "_")}_INPUT_INCOMPLETE`,
      [],
      [rule.missingInput],
    );
  }
  if (rule.candidate.status === "not_present") {
    return result(
      rule.signalId,
      "not_detected_in_provided_data",
      "review",
      rule.notDetectedReason,
      [],
      [],
    );
  }
  if (!rule.detected(rule.candidate.value)) {
    return result(
      rule.signalId,
      "not_detected_in_provided_data",
      "review",
      rule.notDetectedReason,
      rule.candidate.locatorIds,
      [],
    );
  }
  if (rule.candidate.locatorIds.length < (rule.minimumLocatorCount ?? 1)) {
    return result(
      rule.signalId,
      "insufficient_information",
      "review",
      `${rule.signalId.replace("-", "_")}_LOCATOR_REQUIRED`,
      rule.candidate.locatorIds,
      [rule.missingInput],
    );
  }
  return result(
    rule.signalId,
    "detected",
    rule.action,
    rule.detectedReason,
    rule.candidate.locatorIds,
    [],
  );
}

function evaluateFrs004(input: ExtendedFraudEvaluationInput): FraudSignalCheck {
  const payment = input.candidates.paymentRequest;
  if (payment.status === "unknown") {
    return result(
      "FRS-004",
      "insufficient_information",
      "review",
      "FRS_004_PAYMENT_INFORMATION_INCOMPLETE",
      [],
      ["payment_request"],
    );
  }
  if (payment.status === "not_present") {
    return result(
      "FRS-004",
      "not_detected_in_provided_data",
      "review",
      "FRS_004_NO_PAYMENT_REQUEST",
      [],
      [],
    );
  }
  const relationship = input.candidates.paymentPartyRelationship;
  if (relationship.status === "unknown") {
    return result(
      "FRS-004",
      "insufficient_information",
      "review",
      "FRS_004_RELATIONSHIP_INFORMATION_INCOMPLETE",
      payment.locatorIds,
      ["payment_party_relationship"],
    );
  }
  if (relationship.status === "not_present") {
    return result(
      "FRS-004",
      "insufficient_information",
      "review",
      "FRS_004_RELATIONSHIP_INFORMATION_INCOMPLETE",
      payment.locatorIds,
      ["payment_party_relationship"],
    );
  }
  if (relationship.value === "verified_consistent") {
    return result(
      "FRS-004",
      "not_detected_in_provided_data",
      "review",
      "FRS_004_RELATIONSHIP_VERIFIED_CONSISTENT",
      [...payment.locatorIds, ...relationship.locatorIds],
      [],
    );
  }
  return result(
    "FRS-004",
    "detected",
    "stop_and_verify",
    relationship.value === "inconsistent"
      ? "FRS_004_PAYMENT_PARTY_INCONSISTENT"
      : "FRS_004_PAYMENT_PARTY_RELATIONSHIP_UNVERIFIED",
    [...payment.locatorIds, ...relationship.locatorIds],
    [],
  );
}

function evaluateFrs005(input: ExtendedFraudEvaluationInput): FraudSignalCheck {
  const payment = input.candidates.paymentRequest;
  if (payment.status === "unknown") {
    return result(
      "FRS-005",
      "insufficient_information",
      "review",
      "FRS_005_PAYMENT_INFORMATION_INCOMPLETE",
      [],
      ["payment_request"],
    );
  }
  if (payment.status === "not_present") {
    return result(
      "FRS-005",
      "not_detected_in_provided_data",
      "review",
      "FRS_005_NO_PAYMENT_REQUEST",
      [],
      [],
    );
  }
  const authority = input.candidates.lettingAuthorityVerification;
  if (authority.status === "unknown" || authority.status === "not_present") {
    return result(
      "FRS-005",
      "insufficient_information",
      "review",
      "FRS_005_AUTHORITY_INFORMATION_INCOMPLETE",
      payment.locatorIds,
      ["letting_authority_verification"],
    );
  }
  if (authority.value === "verified") {
    return result(
      "FRS-005",
      "not_detected_in_provided_data",
      "review",
      "FRS_005_AUTHORITY_VERIFIED",
      [...payment.locatorIds, ...authority.locatorIds],
      [],
    );
  }
  return result(
    "FRS-005",
    "detected",
    "verify_before_payment",
    authority.value === "not_verified"
      ? "FRS_005_AUTHORITY_NOT_VERIFIED"
      : "FRS_005_AUTHORITY_STATUS_UNKNOWN",
    [...payment.locatorIds, ...authority.locatorIds],
    [],
  );
}

function evaluateFrs009(
  input: ExtendedFraudEvaluationInput,
  currentChecks: readonly FraudSignalCheck[],
): FraudSignalCheck {
  const context = input.candidates.officialRentContext;
  if (context.status === "unknown") {
    return result(
      "FRS-009",
      "insufficient_information",
      "review",
      "FRS_009_OFFICIAL_RENT_CONTEXT_INCOMPLETE",
      [],
      ["comparable_official_rent_context"],
    );
  }
  const rentRefs = [...context.advertisedRentLocatorIds, ...context.officialContextRefIds];
  if (
    !Number.isSafeInteger(context.advertisedMonthlyRentMinor) ||
    context.advertisedMonthlyRentMinor < 0 ||
    !Number.isSafeInteger(context.significantBelowThresholdMinor) ||
    context.significantBelowThresholdMinor <= 0 ||
    context.advertisedRentLocatorIds.length === 0 ||
    context.officialContextRefIds.length === 0
  ) {
    return result(
      "FRS-009",
      "insufficient_information",
      "review",
      "FRS_009_OFFICIAL_RENT_CONTEXT_INVALID",
      rentRefs,
      ["valid_located_official_rent_context"],
    );
  }
  if (context.advertisedMonthlyRentMinor >= context.significantBelowThresholdMinor) {
    return result(
      "FRS-009",
      "not_detected_in_provided_data",
      "review",
      "FRS_009_RENT_NOT_BELOW_CONTEXT_THRESHOLD",
      rentRefs,
      [],
    );
  }

  const companions = [...(input.priorSignalChecks ?? []), ...currentChecks].filter(
    (check) => check.signalId !== "FRS-009",
  );
  const detectedCompanion = companions.find((check) => check.status === "detected");
  if (detectedCompanion !== undefined) {
    return result(
      "FRS-009",
      "detected",
      "verify_before_payment",
      "FRS_009_LOW_RENT_WITH_OTHER_SIGNAL",
      [...rentRefs, ...detectedCompanion.evidenceRefs],
      [],
    );
  }
  if (
    companions.length === 0 ||
    companions.some((check) => check.status === "insufficient_information")
  ) {
    return result(
      "FRS-009",
      "insufficient_information",
      "review",
      "FRS_009_COMPANION_SIGNAL_INFORMATION_INCOMPLETE",
      rentRefs,
      ["another_completed_fraud_signal_check"],
    );
  }
  return result(
    "FRS-009",
    "not_detected_in_provided_data",
    "review",
    "FRS_009_LOW_RENT_WITHOUT_OTHER_SIGNAL",
    rentRefs,
    [],
  );
}

export function evaluateExtendedFraudSignals(
  input: ExtendedFraudEvaluationInput,
): readonly FraudSignalCheck[] {
  const candidates = input.candidates;
  const checks: FraudSignalCheck[] = [
    evaluateCandidate({
      signalId: "FRS-002",
      candidate: candidates.remoteViewingArrangement,
      detected: () => true,
      action: "verify_before_payment",
      detectedReason: "FRS_002_REMOTE_OR_NO_IN_PERSON_VIEWING",
      notDetectedReason: "FRS_002_NO_REMOTE_VIEWING_CUE",
      missingInput: "remote_viewing_arrangement",
    }),
    evaluateCandidate({
      signalId: "FRS-003",
      candidate: candidates.unfamiliarLinkOrCredentialRequest,
      detected: () => true,
      action: "stop_and_verify",
      detectedReason: "FRS_003_UNFAMILIAR_LINK_OR_CREDENTIAL_REQUEST",
      notDetectedReason: "FRS_003_NO_LINK_OR_CREDENTIAL_REQUEST",
      missingInput: "link_or_credential_request",
    }),
    evaluateFrs004(input),
    evaluateFrs005(input),
    evaluateCandidate({
      signalId: "FRS-006",
      candidate: candidates.pressureLanguage,
      detected: () => true,
      action: "verify_before_payment",
      detectedReason: "FRS_006_URGENT_SCARCITY_LANGUAGE",
      notDetectedReason: "FRS_006_NO_URGENT_SCARCITY_LANGUAGE",
      missingInput: "pressure_language",
    }),
    evaluateCandidate({
      signalId: "FRS-007",
      candidate: candidates.paymentMethod,
      detected: (value) => value !== "ordinary_domestic",
      action: "stop_and_verify",
      detectedReason: "FRS_007_HARD_TO_RECOVER_PAYMENT_METHOD",
      notDetectedReason: "FRS_007_NO_HARD_TO_RECOVER_PAYMENT_METHOD",
      missingInput: "payment_method",
    }),
    evaluateCandidate({
      signalId: "FRS-008",
      candidate: candidates.verifiedCrossSourceContradiction,
      detected: () => true,
      action: "verify_before_payment",
      detectedReason: "FRS_008_VERIFIED_CROSS_SOURCE_CONTRADICTION",
      notDetectedReason: "FRS_008_NO_VERIFIED_CROSS_SOURCE_CONTRADICTION",
      missingInput: "verified_cross_source_comparison",
      minimumLocatorCount: 2,
    }),
    evaluateCandidate({
      signalId: "FRS-010",
      candidate: candidates.redirectedAccountVerification,
      detected: () => true,
      action: "stop_and_verify",
      detectedReason: "FRS_010_REDIRECTED_ACCOUNT_OR_BANK_VERIFICATION",
      notDetectedReason: "FRS_010_NO_REDIRECTED_VERIFICATION_REQUEST",
      missingInput: "redirected_account_verification",
    }),
  ];
  checks.splice(7, 0, evaluateFrs009(input, checks));
  return checks;
}
