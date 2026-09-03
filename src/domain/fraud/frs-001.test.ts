import { describe, expect, it } from "vitest";
import { evaluateFrs001, type Frs001Input } from "./frs-001";

const complete: Frs001Input = {
  paymentRequestEvidence: { present: true, locatorId: "locator-payment-request" },
  paymentRequestedAt: { status: "known", value: "2026-09-01T09:00:00+08:00" },
  firstInPersonViewingAt: { status: "known", value: "2026-09-01T15:00:00+08:00" },
};

describe("evaluateFrs001", () => {
  it("detects a located payment request before the first in-person viewing", () => {
    expect(evaluateFrs001(complete)).toMatchObject({
      status: "detected",
      action: "stop_and_verify",
      reasonCode: "FRS_001_PAYMENT_BEFORE_VIEWING",
      evidenceRefs: ["locator-payment-request"],
    });
  });

  it("returns insufficient information when either timeline value is unknown", () => {
    expect(
      evaluateFrs001({ ...complete, paymentRequestedAt: { status: "unknown" } }),
    ).toMatchObject({
      status: "insufficient_information",
      missingInputs: ["payment_requested_at"],
    });
    expect(
      evaluateFrs001({
        ...complete,
        paymentRequestedAt: { status: "unknown" },
        firstInPersonViewingAt: { status: "unknown" },
      }),
    ).toMatchObject({
      missingInputs: ["payment_requested_at", "first_in_person_viewing_at"],
    });
    expect(
      evaluateFrs001({ ...complete, firstInPersonViewingAt: { status: "unknown" } }),
    ).toMatchObject({
      missingInputs: ["first_in_person_viewing_at"],
    });
  });

  it("does not detect the signal when payment is requested after viewing", () => {
    expect(
      evaluateFrs001({
        ...complete,
        paymentRequestedAt: { status: "known", value: "2026-09-01T16:00:00+08:00" },
      }),
    ).toMatchObject({
      status: "not_detected_in_provided_data",
      action: "review",
    });
  });

  it("requires payment evidence with a locator", () => {
    expect(
      evaluateFrs001({ ...complete, paymentRequestEvidence: { present: true } }),
    ).toMatchObject({
      status: "insufficient_information",
      reasonCode: "FRS_001_PAYMENT_EVIDENCE_MISSING",
    });
    expect(
      evaluateFrs001({
        ...complete,
        paymentRequestEvidence: { present: false, locatorId: "locator-payment-request" },
      }),
    ).toMatchObject({ reasonCode: "FRS_001_PAYMENT_EVIDENCE_MISSING" });
  });

  it("treats invalid timestamps as incomplete instead of guessing", () => {
    expect(
      evaluateFrs001({
        ...complete,
        firstInPersonViewingAt: { status: "known", value: "not-a-date" },
      }),
    ).toMatchObject({
      status: "insufficient_information",
      reasonCode: "FRS_001_TIMELINE_INCOMPLETE",
    });
    expect(
      evaluateFrs001({
        ...complete,
        paymentRequestedAt: { status: "known", value: "not-a-date" },
      }),
    ).toMatchObject({
      status: "insufficient_information",
      missingInputs: ["valid_timeline"],
    });
  });
});
