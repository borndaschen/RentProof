export type KnownInstant = { status: "known"; value: string } | { status: "unknown" };

export type Frs001Input = {
  paymentRequestEvidence: {
    present: boolean;
    locatorId?: string;
  };
  paymentRequestedAt: KnownInstant;
  firstInPersonViewingAt: KnownInstant;
};

export type Frs001Result = {
  signalId: "FRS-001";
  status: "detected" | "not_detected_in_provided_data" | "insufficient_information";
  action: "review" | "stop_and_verify";
  reasonCode:
    | "FRS_001_PAYMENT_BEFORE_VIEWING"
    | "FRS_001_PAYMENT_NOT_BEFORE_VIEWING"
    | "FRS_001_PAYMENT_EVIDENCE_MISSING"
    | "FRS_001_TIMELINE_INCOMPLETE";
  evidenceRefs: readonly string[];
  missingInputs: readonly string[];
  humanVerificationRequired: true;
};

export function evaluateFrs001(input: Frs001Input): Frs001Result {
  if (!input.paymentRequestEvidence.present || !input.paymentRequestEvidence.locatorId) {
    return insufficient("FRS_001_PAYMENT_EVIDENCE_MISSING", ["payment_request_with_locator"]);
  }

  if (
    input.paymentRequestedAt.status === "unknown" ||
    input.firstInPersonViewingAt.status === "unknown"
  ) {
    const missingInputs: string[] = [];
    if (input.paymentRequestedAt.status === "unknown") missingInputs.push("payment_requested_at");
    if (input.firstInPersonViewingAt.status === "unknown") {
      missingInputs.push("first_in_person_viewing_at");
    }
    return insufficient("FRS_001_TIMELINE_INCOMPLETE", missingInputs, [
      input.paymentRequestEvidence.locatorId,
    ]);
  }

  const paymentTime = Date.parse(input.paymentRequestedAt.value);
  const viewingTime = Date.parse(input.firstInPersonViewingAt.value);
  if (!Number.isFinite(paymentTime) || !Number.isFinite(viewingTime)) {
    return insufficient(
      "FRS_001_TIMELINE_INCOMPLETE",
      ["valid_timeline"],
      [input.paymentRequestEvidence.locatorId],
    );
  }

  if (paymentTime < viewingTime) {
    return {
      signalId: "FRS-001",
      status: "detected",
      action: "stop_and_verify",
      reasonCode: "FRS_001_PAYMENT_BEFORE_VIEWING",
      evidenceRefs: [input.paymentRequestEvidence.locatorId],
      missingInputs: [],
      humanVerificationRequired: true,
    };
  }

  return {
    signalId: "FRS-001",
    status: "not_detected_in_provided_data",
    action: "review",
    reasonCode: "FRS_001_PAYMENT_NOT_BEFORE_VIEWING",
    evidenceRefs: [input.paymentRequestEvidence.locatorId],
    missingInputs: [],
    humanVerificationRequired: true,
  };
}

function insufficient(
  reasonCode: "FRS_001_PAYMENT_EVIDENCE_MISSING" | "FRS_001_TIMELINE_INCOMPLETE",
  missingInputs: readonly string[],
  evidenceRefs: readonly string[] = [],
): Frs001Result {
  return {
    signalId: "FRS-001",
    status: "insufficient_information",
    action: "review",
    reasonCode,
    evidenceRefs,
    missingInputs,
    humanVerificationRequired: true,
  };
}
