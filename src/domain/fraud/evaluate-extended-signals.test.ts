import { describe, expect, it } from "vitest";
import type {
  ExtendedFraudEvaluationInput,
  FraudCandidateFacts,
  FraudSignalCheck,
} from "./contracts";
import { evaluateExtendedFraudSignals } from "./evaluate-extended-signals";

const absent = { status: "not_present" } as const;

function completeCandidates(): FraudCandidateFacts {
  return {
    remoteViewingArrangement: absent,
    unfamiliarLinkOrCredentialRequest: absent,
    paymentRequest: absent,
    paymentPartyRelationship: absent,
    lettingAuthorityVerification: absent,
    pressureLanguage: absent,
    paymentMethod: {
      status: "present",
      value: "ordinary_domestic",
      locatorIds: ["loc-payment-method"],
    },
    verifiedCrossSourceContradiction: absent,
    redirectedAccountVerification: absent,
    officialRentContext: {
      status: "present",
      advertisedMonthlyRentMinor: 15_000_00,
      significantBelowThresholdMinor: 10_000_00,
      advertisedRentLocatorIds: ["loc-rent"],
      officialContextRefIds: ["official-rent-context-v1"],
    },
  };
}

function evaluate(
  candidates: Partial<FraudCandidateFacts> = {},
  priorSignalChecks?: readonly FraudSignalCheck[],
) {
  const input: ExtendedFraudEvaluationInput = {
    candidates: { ...completeCandidates(), ...candidates },
    ...(priorSignalChecks === undefined ? {} : { priorSignalChecks }),
  };
  return evaluateExtendedFraudSignals(input);
}

function check(
  checks: readonly FraudSignalCheck[],
  signalId: FraudSignalCheck["signalId"],
): FraudSignalCheck {
  const found = checks.find((item) => item.signalId === signalId);
  if (found === undefined) throw new Error(`missing ${signalId}`);
  return found;
}

describe("evaluateExtendedFraudSignals", () => {
  it("returns FRS-002 through FRS-010 in stable catalog order", () => {
    expect(evaluate().map((item) => item.signalId)).toEqual([
      "FRS-002",
      "FRS-003",
      "FRS-004",
      "FRS-005",
      "FRS-006",
      "FRS-007",
      "FRS-008",
      "FRS-009",
      "FRS-010",
    ]);
  });

  it.each([
    ["FRS-002", "remoteViewingArrangement", "remote_location_claim", "verify_before_payment"],
    ["FRS-003", "unfamiliarLinkOrCredentialRequest", "otp_request", "stop_and_verify"],
    ["FRS-006", "pressureLanguage", "pay_now_to_reserve", "verify_before_payment"],
    ["FRS-007", "paymentMethod", "cryptocurrency", "stop_and_verify"],
    ["FRS-008", "verifiedCrossSourceContradiction", "listing_contract", "verify_before_payment"],
    ["FRS-010", "redirectedAccountVerification", "line_account_verification", "stop_and_verify"],
  ] as const)(
    "detects %s only from a located typed candidate",
    (signalId, field, value, action) => {
      const locatorIds =
        signalId === "FRS-008"
          ? [`loc-${signalId}-left`, `loc-${signalId}-right`]
          : [`loc-${signalId}`];
      const checks = evaluate({
        [field]: { status: "present", value, locatorIds },
      });
      expect(check(checks, signalId)).toMatchObject({
        status: "detected",
        action,
        evidenceRefs: locatorIds,
        missingInputs: [],
        humanVerificationRequired: true,
      });
    },
  );

  it.each([
    ["FRS-002", "remoteViewingArrangement"],
    ["FRS-003", "unfamiliarLinkOrCredentialRequest"],
    ["FRS-006", "pressureLanguage"],
    ["FRS-007", "paymentMethod"],
    ["FRS-008", "verifiedCrossSourceContradiction"],
    ["FRS-010", "redirectedAccountVerification"],
  ] as const)("returns insufficient information for unknown %s input", (signalId, field) => {
    const checks = evaluate({ [field]: { status: "unknown" } });
    expect(check(checks, signalId)).toMatchObject({
      status: "insufficient_information",
      action: "review",
    });
  });

  it("does not detect an ordinary domestic payment method", () => {
    expect(check(evaluate(), "FRS-007")).toMatchObject({
      status: "not_detected_in_provided_data",
      reasonCode: "FRS_007_NO_HARD_TO_RECOVER_PAYMENT_METHOD",
    });
  });

  it("detects an unverified or inconsistent payment party only when payment is requested", () => {
    for (const relationship of ["unverified", "inconsistent"] as const) {
      const outcome = check(
        evaluate({
          paymentRequest: {
            status: "present",
            value: "payment_requested",
            locatorIds: ["loc-payment"],
          },
          paymentPartyRelationship: {
            status: "present",
            value: relationship,
            locatorIds: ["loc-party"],
          },
        }),
        "FRS-004",
      );
      expect(outcome).toMatchObject({
        status: "detected",
        action: "stop_and_verify",
        evidenceRefs: ["loc-payment", "loc-party"],
      });
    }
    expect(
      check(
        evaluate({
          paymentPartyRelationship: {
            status: "present",
            value: "inconsistent",
            locatorIds: ["loc-party"],
          },
        }),
        "FRS-004",
      ).status,
    ).toBe("not_detected_in_provided_data");
  });

  it("requires completed relationship data before reporting no FRS-004 signal", () => {
    const paymentRequest = {
      status: "present",
      value: "payment_requested",
      locatorIds: ["loc-payment"],
    } as const;
    expect(
      check(
        evaluate({ paymentRequest, paymentPartyRelationship: { status: "unknown" } }),
        "FRS-004",
      ),
    ).toMatchObject({ status: "insufficient_information" });
    expect(
      check(
        evaluate({
          paymentRequest,
          paymentPartyRelationship: {
            status: "present",
            value: "verified_consistent",
            locatorIds: ["loc-party"],
          },
        }),
        "FRS-004",
      ),
    ).toMatchObject({ status: "not_detected_in_provided_data" });
  });

  it("detects a payment request when authority is explicitly not verified or unknown", () => {
    for (const authority of ["not_verified", "unknown"] as const) {
      expect(
        check(
          evaluate({
            paymentRequest: {
              status: "present",
              value: "payment_requested",
              locatorIds: ["loc-payment"],
            },
            lettingAuthorityVerification: {
              status: "present",
              value: authority,
              locatorIds: ["loc-authority"],
            },
          }),
          "FRS-005",
        ),
      ).toMatchObject({
        status: "detected",
        action: "verify_before_payment",
        evidenceRefs: ["loc-payment", "loc-authority"],
      });
    }
  });

  it("requires payment and authority completeness for FRS-005", () => {
    expect(check(evaluate({ paymentRequest: { status: "unknown" } }), "FRS-005")).toMatchObject({
      status: "insufficient_information",
    });
    expect(
      check(
        evaluate({
          paymentRequest: {
            status: "present",
            value: "payment_requested",
            locatorIds: ["loc-payment"],
          },
          lettingAuthorityVerification: { status: "unknown" },
        }),
        "FRS-005",
      ),
    ).toMatchObject({ status: "insufficient_information" });
    expect(
      check(
        evaluate({
          paymentRequest: {
            status: "present",
            value: "payment_requested",
            locatorIds: ["loc-payment"],
          },
          lettingAuthorityVerification: {
            status: "present",
            value: "verified",
            locatorIds: ["loc-authority"],
          },
        }),
        "FRS-005",
      ),
    ).toMatchObject({ status: "not_detected_in_provided_data" });
  });

  it("never detects FRS-009 from low rent alone", () => {
    const lowRent = {
      status: "present",
      advertisedMonthlyRentMinor: 7_000_00,
      significantBelowThresholdMinor: 10_000_00,
      advertisedRentLocatorIds: ["loc-rent"],
      officialContextRefIds: ["official-rent-context-v1"],
    } as const;
    const completedNoSignal: FraudSignalCheck = {
      signalId: "FRS-001",
      status: "not_detected_in_provided_data",
      action: "review",
      reasonCode: "FRS_001_PAYMENT_NOT_BEFORE_VIEWING",
      evidenceRefs: ["loc-timeline"],
      missingInputs: [],
      humanVerificationRequired: true,
    };
    expect(
      check(evaluate({ officialRentContext: lowRent }, [completedNoSignal]), "FRS-009"),
    ).toMatchObject({
      status: "not_detected_in_provided_data",
      reasonCode: "FRS_009_LOW_RENT_WITHOUT_OTHER_SIGNAL",
    });
  });

  it("detects FRS-009 only with located official context and another detected signal", () => {
    const checks = evaluate({
      officialRentContext: {
        status: "present",
        advertisedMonthlyRentMinor: 7_000_00,
        significantBelowThresholdMinor: 10_000_00,
        advertisedRentLocatorIds: ["loc-rent"],
        officialContextRefIds: ["official-rent-context-v1"],
      },
      pressureLanguage: {
        status: "present",
        value: "competing_renter",
        locatorIds: ["loc-pressure"],
      },
    });
    expect(check(checks, "FRS-009")).toMatchObject({
      status: "detected",
      action: "verify_before_payment",
      evidenceRefs: ["loc-rent", "official-rent-context-v1", "loc-pressure"],
    });
  });

  it("keeps FRS-009 insufficient when rent context or companion checks are incomplete", () => {
    expect(
      check(evaluate({ officialRentContext: { status: "unknown" } }), "FRS-009"),
    ).toMatchObject({ status: "insufficient_information" });
    expect(
      check(
        evaluate({
          officialRentContext: {
            status: "present",
            advertisedMonthlyRentMinor: 7_000_00,
            significantBelowThresholdMinor: 10_000_00,
            advertisedRentLocatorIds: ["loc-rent"],
            officialContextRefIds: ["official-rent-context-v1"],
          },
          pressureLanguage: { status: "unknown" },
        }),
        "FRS-009",
      ),
    ).toMatchObject({ status: "insufficient_information" });
  });

  it("fails closed when a present detected candidate has no locator", () => {
    expect(
      check(
        evaluate({
          pressureLanguage: {
            status: "present",
            value: "pay_now_to_reserve",
            locatorIds: [],
          },
        }),
        "FRS-006",
      ),
    ).toMatchObject({
      status: "insufficient_information",
      reasonCode: "FRS_006_LOCATOR_REQUIRED",
      missingInputs: ["pressure_language"],
    });
  });

  it("also guards composite detected rules against locator-free direct domain input", () => {
    expect(
      check(
        evaluate({
          paymentRequest: {
            status: "present",
            value: "payment_requested",
            locatorIds: [],
          },
          paymentPartyRelationship: {
            status: "present",
            value: "inconsistent",
            locatorIds: [],
          },
        }),
        "FRS-004",
      ),
    ).toMatchObject({
      status: "insufficient_information",
      reasonCode: "FRS_004_LOCATOR_REQUIRED",
      missingInputs: ["located_evidence"],
    });
  });

  it("requires both sides of an FRS-008 contradiction to be located", () => {
    expect(
      check(
        evaluate({
          verifiedCrossSourceContradiction: {
            status: "present",
            value: "listing_contract",
            locatorIds: ["loc-listing-only"],
          },
        }),
        "FRS-008",
      ),
    ).toMatchObject({
      status: "insufficient_information",
      reasonCode: "FRS_008_LOCATOR_REQUIRED",
    });
  });

  it("treats invalid official rent amounts or missing refs as insufficient", () => {
    expect(
      check(
        evaluate({
          officialRentContext: {
            status: "present",
            advertisedMonthlyRentMinor: -1,
            significantBelowThresholdMinor: 0,
            advertisedRentLocatorIds: [],
            officialContextRefIds: [],
          },
        }),
        "FRS-009",
      ),
    ).toMatchObject({
      status: "insufficient_information",
      reasonCode: "FRS_009_OFFICIAL_RENT_CONTEXT_INVALID",
    });
  });

  it("guarantees every detected result has explicit evidence refs", () => {
    const checks = evaluate({
      remoteViewingArrangement: {
        status: "present",
        value: "keys_by_delivery_only",
        locatorIds: ["loc-remote"],
      },
      unfamiliarLinkOrCredentialRequest: {
        status: "present",
        value: "unfamiliar_logistics_link",
        locatorIds: ["loc-link"],
      },
      pressureLanguage: {
        status: "present",
        value: "other_urgent_scarcity",
        locatorIds: ["loc-pressure"],
      },
    });
    for (const detected of checks.filter((item) => item.status === "detected")) {
      expect(detected.evidenceRefs.length).toBeGreaterThan(0);
    }
  });
});
