import { describe, expect, it } from "vitest";
import { evaluateValidatedFraudCandidates } from "./evaluate-candidates";

function validInput() {
  return {
    candidates: {
      remoteViewingArrangement: { status: "not_present" },
      unfamiliarLinkOrCredentialRequest: { status: "not_present" },
      paymentRequest: { status: "not_present" },
      paymentPartyRelationship: { status: "not_present" },
      lettingAuthorityVerification: { status: "not_present" },
      pressureLanguage: { status: "not_present" },
      paymentMethod: {
        status: "present",
        value: "ordinary_domestic",
        locatorIds: ["loc-payment-method"],
      },
      verifiedCrossSourceContradiction: { status: "not_present" },
      redirectedAccountVerification: { status: "not_present" },
      officialRentContext: {
        status: "present",
        advertisedMonthlyRentMinor: 15_000_00,
        significantBelowThresholdMinor: 10_000_00,
        advertisedRentLocatorIds: ["loc-rent"],
        officialContextRefIds: ["official-rent-context-v1"],
      },
    },
  } as const;
}

describe("evaluateValidatedFraudCandidates", () => {
  it("validates candidates then returns only deterministic signal results", () => {
    const base = validInput();
    const input = {
      ...base,
      candidates: {
        ...base.candidates,
        pressureLanguage: {
          status: "present",
          value: "pay_now_to_reserve",
          locatorIds: ["loc-pressure"],
        },
      },
    };
    expect(
      evaluateValidatedFraudCandidates(input).find((item) => item.signalId === "FRS-006"),
    ).toMatchObject({
      status: "detected",
      action: "verify_before_payment",
      evidenceRefs: ["loc-pressure"],
    });
  });

  it("rejects located candidates without locators", () => {
    const base = validInput();
    const input = {
      ...base,
      candidates: {
        ...base.candidates,
        pressureLanguage: {
          status: "present",
          value: "competing_renter",
          locatorIds: [],
        },
      },
    };
    expect(() => evaluateValidatedFraudCandidates(input)).toThrow();
  });

  it("rejects extractor attempts to inject a signal status or unknown field", () => {
    const input = validInput() as ReturnType<typeof validInput> & {
      status?: string;
    };
    input.status = "detected";
    expect(() => evaluateValidatedFraudCandidates(input)).toThrow();
  });

  it("rejects invalid rent context instead of letting low rent trigger", () => {
    const base = validInput();
    const input = {
      ...base,
      candidates: {
        ...base.candidates,
        officialRentContext: {
          ...base.candidates.officialRentContext,
          significantBelowThresholdMinor: 0,
        },
      },
    };
    expect(() => evaluateValidatedFraudCandidates(input)).toThrow();
  });
});
