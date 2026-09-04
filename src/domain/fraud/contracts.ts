export const FRAUD_SIGNAL_IDS = [
  "FRS-001",
  "FRS-002",
  "FRS-003",
  "FRS-004",
  "FRS-005",
  "FRS-006",
  "FRS-007",
  "FRS-008",
  "FRS-009",
  "FRS-010",
] as const;

export type FraudSignalId = (typeof FRAUD_SIGNAL_IDS)[number];
export type ExtendedFraudSignalId = Exclude<FraudSignalId, "FRS-001">;

export type FraudSignalStatus =
  "detected" | "not_detected_in_provided_data" | "insufficient_information";

export type FraudAction = "review" | "verify_before_payment" | "stop_and_verify";

export type FraudSignalCheck = Readonly<{
  signalId: FraudSignalId;
  status: FraudSignalStatus;
  action: FraudAction;
  reasonCode: string;
  evidenceRefs: readonly string[];
  missingInputs: readonly string[];
  humanVerificationRequired: true;
}>;

export type LocatedCandidate<T> =
  | Readonly<{ status: "present"; value: T; locatorIds: readonly string[] }>
  | Readonly<{ status: "not_present" }>
  | Readonly<{ status: "unknown" }>;

export type PaymentRequestCandidate = LocatedCandidate<"payment_requested">;

export type FraudCandidateFacts = Readonly<{
  remoteViewingArrangement: LocatedCandidate<
    "remote_location_claim" | "in_person_viewing_refused" | "keys_by_delivery_only"
  >;
  unfamiliarLinkOrCredentialRequest: LocatedCandidate<
    | "unfamiliar_logistics_link"
    | "unfamiliar_convenience_store_link"
    | "unfamiliar_customer_service_link"
    | "online_banking_request"
    | "credit_card_request"
    | "otp_request"
  >;
  paymentRequest: PaymentRequestCandidate;
  paymentPartyRelationship: LocatedCandidate<"verified_consistent" | "unverified" | "inconsistent">;
  lettingAuthorityVerification: LocatedCandidate<"verified" | "not_verified" | "unknown">;
  pressureLanguage: LocatedCandidate<
    "competing_renter" | "pay_now_to_reserve" | "other_urgent_scarcity"
  >;
  paymentMethod: LocatedCandidate<
    | "ordinary_domestic"
    | "cross_border_transfer"
    | "cryptocurrency"
    | "gift_card"
    | "other_hard_to_recover"
  >;
  verifiedCrossSourceContradiction: LocatedCandidate<
    | "listing_viewing"
    | "listing_contract"
    | "contract_payment"
    | "party_role"
    | "other_verified_pair"
  >;
  redirectedAccountVerification: LocatedCandidate<
    | "unfamiliar_customer_service_account_verification"
    | "line_account_verification"
    | "unfamiliar_customer_service_personal_information"
    | "line_personal_information"
    | "unfamiliar_customer_service_online_banking_operation"
    | "line_online_banking_operation"
  >;
  officialRentContext:
    | Readonly<{
        status: "present";
        advertisedMonthlyRentMinor: number;
        significantBelowThresholdMinor: number;
        advertisedRentLocatorIds: readonly string[];
        officialContextRefIds: readonly string[];
      }>
    | Readonly<{ status: "unknown" }>;
}>;

export type ExtendedFraudEvaluationInput = Readonly<{
  candidates: FraudCandidateFacts;
  priorSignalChecks?: readonly FraudSignalCheck[];
}>;
