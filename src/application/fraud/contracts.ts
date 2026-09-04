import { z } from "zod";

const ReferenceIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);

function locatedCandidateSchema<const T extends readonly [string, ...string[]]>(values: T) {
  return z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("present"),
        value: z.enum(values),
        locatorIds: z.array(ReferenceIdSchema).min(1).max(20),
      })
      .strict(),
    z.object({ status: z.literal("not_present") }).strict(),
    z.object({ status: z.literal("unknown") }).strict(),
  ]);
}

const VerifiedCrossSourceContradictionSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("present"),
      value: z.enum([
        "listing_viewing",
        "listing_contract",
        "contract_payment",
        "party_role",
        "other_verified_pair",
      ]),
      locatorIds: z.array(ReferenceIdSchema).min(2).max(20),
    })
    .strict(),
  z.object({ status: z.literal("not_present") }).strict(),
  z.object({ status: z.literal("unknown") }).strict(),
]);

const FraudSignalCheckSchema = z
  .object({
    signalId: z.enum([
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
    ]),
    status: z.enum(["detected", "not_detected_in_provided_data", "insufficient_information"]),
    action: z.enum(["review", "verify_before_payment", "stop_and_verify"]),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,95}$/u),
    evidenceRefs: z.array(ReferenceIdSchema).max(20),
    missingInputs: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,95}$/u)).max(20),
    humanVerificationRequired: z.literal(true),
  })
  .strict()
  .superRefine((check, context) => {
    if (check.status === "detected" && check.evidenceRefs.length === 0) {
      context.addIssue({ code: "custom", message: "DETECTED_SIGNAL_LOCATOR_REQUIRED" });
    }
  });

export const ExtendedFraudCandidateInputSchema = z
  .object({
    candidates: z
      .object({
        remoteViewingArrangement: locatedCandidateSchema([
          "remote_location_claim",
          "in_person_viewing_refused",
          "keys_by_delivery_only",
        ]),
        unfamiliarLinkOrCredentialRequest: locatedCandidateSchema([
          "unfamiliar_logistics_link",
          "unfamiliar_convenience_store_link",
          "unfamiliar_customer_service_link",
          "online_banking_request",
          "credit_card_request",
          "otp_request",
        ]),
        paymentRequest: locatedCandidateSchema(["payment_requested"]),
        paymentPartyRelationship: locatedCandidateSchema([
          "verified_consistent",
          "unverified",
          "inconsistent",
        ]),
        lettingAuthorityVerification: locatedCandidateSchema([
          "verified",
          "not_verified",
          "unknown",
        ]),
        pressureLanguage: locatedCandidateSchema([
          "competing_renter",
          "pay_now_to_reserve",
          "other_urgent_scarcity",
        ]),
        paymentMethod: locatedCandidateSchema([
          "ordinary_domestic",
          "cross_border_transfer",
          "cryptocurrency",
          "gift_card",
          "other_hard_to_recover",
        ]),
        verifiedCrossSourceContradiction: VerifiedCrossSourceContradictionSchema,
        redirectedAccountVerification: locatedCandidateSchema([
          "unfamiliar_customer_service_account_verification",
          "line_account_verification",
          "unfamiliar_customer_service_personal_information",
          "line_personal_information",
          "unfamiliar_customer_service_online_banking_operation",
          "line_online_banking_operation",
        ]),
        officialRentContext: z.discriminatedUnion("status", [
          z
            .object({
              status: z.literal("present"),
              advertisedMonthlyRentMinor: z.number().int().nonnegative().max(1_000_000_000),
              significantBelowThresholdMinor: z.number().int().positive().max(1_000_000_000),
              advertisedRentLocatorIds: z.array(ReferenceIdSchema).min(1).max(20),
              officialContextRefIds: z.array(ReferenceIdSchema).min(1).max(20),
            })
            .strict(),
          z.object({ status: z.literal("unknown") }).strict(),
        ]),
      })
      .strict(),
    priorSignalChecks: z.array(FraudSignalCheckSchema).max(10).optional(),
  })
  .strict();

export type ExtendedFraudCandidateInput = z.infer<typeof ExtendedFraudCandidateInputSchema>;
