import type { Finding } from "../evidence-graph";
import type { OfficialRuleCheck } from "../official-rules";
import { evaluateNonNaturalDeathDisclosure } from "../non-natural-death-disclosure";
import { composeActionCards, type ActionCardDraft } from "./action-card";
import { assertNeutralReportLanguage } from "./forbidden-language";
import {
  PreSigningReportInputSchema,
  PreSigningReportSchema,
  type PreSigningReport,
  type PreSigningReportInput,
} from "./schema";

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function findingSourceRefs(finding: Finding): string[] {
  return uniqueSorted(finding.evidenceRefs.map((reference) => reference.locator.locatorId));
}

function findingAction(finding: Finding): ActionCardDraft | null {
  const sourceRefs = findingSourceRefs(finding);
  if (finding.findingType === "claim_comparison") {
    if (finding.status === "contradicted") {
      return {
        actionId: `finding-${finding.id}-ask`,
        actionType: "ask",
        reasonClass: "explicit_contradiction",
        target: { kind: "finding", refId: finding.id },
        sourceRefs,
        completionConditions: ["written_answer_recorded"],
        reasonCode: finding.reasonCode,
      };
    }
    if (finding.status === "insufficient_evidence") {
      return {
        actionId: `finding-${finding.id}-attach`,
        actionType: "attach",
        reasonClass: "insufficient_evidence",
        target: { kind: "finding", refId: finding.id },
        sourceRefs,
        completionConditions: ["requested_document_attached_and_verified"],
        reasonCode: finding.reasonCode,
      };
    }
    return null;
  }
  if (finding.status === "additional_evidence_needed") {
    return {
      actionId: `finding-${finding.id}-photograph`,
      actionType: "photograph",
      reasonClass: "insufficient_evidence",
      target: { kind: "finding", refId: finding.id },
      sourceRefs,
      completionConditions: ["requested_photos_attached_and_located"],
      reasonCode: finding.reasonCode,
    };
  }
  return null;
}

function ruleAction(
  rule: OfficialRuleCheck,
  sourceRefs: readonly string[],
): ActionCardDraft | null {
  if (rule.result === "possible_difference") {
    return {
      actionId: `rule-${rule.ruleId}-modify`,
      actionType: "modify",
      reasonClass: "official_rule_possible_difference",
      target: { kind: "rule_check", refId: rule.ruleId },
      sourceRefs: uniqueSorted(sourceRefs),
      completionConditions: ["contract_or_confirmation_updated_and_attached"],
      reasonCode: rule.reasonCode,
    };
  }
  if (rule.result === "missing_information") {
    return {
      actionId: `rule-${rule.ruleId}-attach`,
      actionType: "attach",
      reasonClass: "missing_verification_information",
      target: { kind: "rule_check", refId: rule.ruleId },
      sourceRefs: uniqueSorted(sourceRefs),
      completionConditions: ["requested_document_attached_and_verified"],
      reasonCode: rule.reasonCode,
    };
  }
  return null;
}

function fraudAction(
  signal: PreSigningReportInput["fraudSignals"][number],
): ActionCardDraft | null {
  if (signal.status === "not_detected_in_provided_data") return null;
  return {
    actionId: `fraud-${signal.signalId}-verify`,
    actionType: "verify",
    reasonClass:
      signal.status === "detected" ? "payment_verification" : "missing_verification_information",
    target: { kind: "fraud_signal", refId: signal.signalId },
    sourceRefs: uniqueSorted(signal.sourceRefIds),
    completionConditions: ["payment_request_verified_before_payment"],
    reasonCode: signal.reasonCode,
  };
}

function evidenceItem(finding: Extract<Finding, { findingType: "claim_comparison" }>) {
  return {
    findingId: finding.id,
    status: finding.status,
    reasonCode: finding.reasonCode,
    sourceRefs: findingSourceRefs(finding),
  };
}

function compareById<T>(id: (value: T) => string): (left: T, right: T) => number {
  return (left, right) => id(left).localeCompare(id(right));
}

export function composePreSigningReport(input: unknown): PreSigningReport {
  const parsed = PreSigningReportInputSchema.parse(input);
  assertNeutralReportLanguage(parsed);

  const claimFindings = parsed.findings.filter(
    (finding): finding is Extract<Finding, { findingType: "claim_comparison" }> =>
      finding.findingType === "claim_comparison",
  );
  const reportEvidence = claimFindings.map(evidenceItem);

  const applicableRules = parsed.ruleChecks.filter((entry) => entry.check.result !== null);
  const reportRules = applicableRules.map((entry) => ({
    ruleId: entry.check.ruleId,
    result: entry.check.result,
    reasonCode: entry.check.reasonCode,
    sourceRefs: uniqueSorted(entry.sourceRefIds),
    officialSource: entry.check.officialSource,
  }));

  const paymentVerification = parsed.fraudSignals
    .map((signal) => ({
      signalId: signal.signalId,
      status:
        signal.status === "detected" ? ("payment_verification_required" as const) : signal.status,
      reasonCode: signal.reasonCode,
      sourceRefs: uniqueSorted(signal.sourceRefIds),
    }))
    .sort(compareById((item) => item.signalId));

  const actionDrafts = [
    ...parsed.findings.map(findingAction),
    ...parsed.ruleChecks.map((entry) => ruleAction(entry.check, entry.sourceRefIds)),
    ...parsed.fraudSignals.map(fraudAction),
  ].filter((draft): draft is ActionCardDraft => draft !== null);

  const costs = {
    ...parsed.costSummary,
    fixedMonthly: {
      ...parsed.costSummary.fixedMonthly,
      items: [...parsed.costSummary.fixedMonthly.items].sort(compareById((item) => item.id)),
    },
    variable: [...parsed.costSummary.variable].sort(compareById((item) => item.id)),
    oneTime: {
      ...parsed.costSummary.oneTime,
      items: [...parsed.costSummary.oneTime.items].sort(compareById((item) => item.id)),
    },
  };

  const report = PreSigningReportSchema.parse({
    schema: "rentproof.pre-signing-report.v1",
    provenance: parsed.provenance,
    sources: [...parsed.sourceLocators].sort(compareById((source) => source.refId)),
    evidence: {
      supported: reportEvidence
        .filter((item) => item.status === "supported")
        .sort(compareById((item) => item.findingId)),
      contradicted: reportEvidence
        .filter((item) => item.status === "contradicted")
        .sort(compareById((item) => item.findingId)),
      insufficientEvidence: reportEvidence
        .filter((item) => item.status === "insufficient_evidence")
        .sort(compareById((item) => item.findingId)),
    },
    officialRules: {
      noDifferenceFound: reportRules
        .filter((item) => item.result === "no_difference_found")
        .sort(compareById((item) => item.ruleId)),
      possibleDifference: reportRules
        .filter((item) => item.result === "possible_difference")
        .sort(compareById((item) => item.ruleId)),
      missingInformation: reportRules
        .filter((item) => item.result === "missing_information")
        .sort(compareById((item) => item.ruleId)),
    },
    paymentVerification,
    nonNaturalDeathDisclosure: evaluateNonNaturalDeathDisclosure({
      statements: parsed.nonNaturalDeathDisclosureStatements,
    }),
    costs,
    actions: composeActionCards(actionDrafts),
  });
  assertNeutralReportLanguage(report);
  return report;
}
