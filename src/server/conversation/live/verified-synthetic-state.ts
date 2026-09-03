import "server-only";
import { SingleCaseAggregateSchema } from "@/application/case-commands";
import { ServerConversationStateSchema } from "@/domain/conversation";
import { PublicFixtureAnalysisSnapshotSchema } from "@/server/demo/fixture-analysis";

export function projectVerifiedSyntheticConversationState(input: {
  sealedSnapshot: unknown;
  caseAggregate: unknown;
}) {
  const snapshot = PublicFixtureAnalysisSnapshotSchema.parse(input.sealedSnapshot);
  const aggregate = SingleCaseAggregateSchema.parse(input.caseAggregate);
  return ServerConversationStateSchema.parse({
    schemaVersion: "rentproof.server-conversation-state.v1",
    casePhase: "report_ready",
    caseRevision: aggregate.revision,
    snapshotId: snapshot.snapshotId,
    executionMode: "live",
    availableActions: [
      "show_next_step",
      "show_case_summary",
      "open_workspace",
      "explain_focus",
      "show_source",
      "update_case_profile",
      "update_fraud_timeline",
    ],
    pendingCandidateTypes: [],
    knownFields: {
      residentialLease: aggregate.caseProfile.residentialLease.status === "known",
      intendedLeaseMonths: aggregate.caseProfile.intendedLeaseMonths.status === "known",
      plannedSigningDate: aggregate.caseProfile.plannedSigningDate.status === "known",
      electricityPayer: aggregate.caseProfile.electricityPayer.status === "known",
      paymentRequestedAt: aggregate.fraudTimeline.paymentRequestedAt.status === "known",
      firstInPersonViewingAt: aggregate.fraudTimeline.firstInPersonViewingAt.status === "known",
    },
  });
}
