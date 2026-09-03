import "server-only";
import { randomUUID } from "node:crypto";
import { createOpenAIConversationIntentAdapter } from "@/adapters/openai/conversation-intent-adapter";
import { HybridAssistantResponseComposer } from "@/application/conversation/assistant";
import { InMemoryConversationBudgetRepository } from "@/application/conversation/budget";
import { AssistantTurnSchema, type AssistantTurn } from "@/domain/conversation";
import {
  getLiveSyntheticCaseAggregate,
  issueLiveMaterialConfirmation,
} from "@/server/conversation/confirmation/runtime";
import { loadFixtureAnalysisSnapshot } from "@/server/demo/fixture-analysis";
import {
  InMemoryLiveConversationCaseLease,
  LiveConversationHandler,
} from "./live-conversation-handler";
import { projectVerifiedSyntheticConversationState } from "./verified-synthetic-state";

const budget = new InMemoryConversationBudgetRepository();
const lease = new InMemoryLiveConversationCaseLease();
const composer = new HybridAssistantResponseComposer();

export async function executeLiveConversationTurn(input: {
  apiKey: string;
  caseId: string;
  actorRef: string;
  normalizedTurn: string;
}): Promise<
  | { ok: true; turn: AssistantTurn }
  | { ok: false; code: string; templateKey: "provider_error" | "validation_error" }
> {
  const handler = new LiveConversationHandler({
    adapter: createOpenAIConversationIntentAdapter(input.apiKey),
    budget,
    lease,
    clock: { now: () => new Date() },
  });
  const [sealedSnapshot, caseAggregate] = await Promise.all([
    loadFixtureAnalysisSnapshot(),
    getLiveSyntheticCaseAggregate(),
  ]);
  if (caseAggregate === null || caseAggregate.caseId !== input.caseId) {
    return { ok: false, code: "CASE_NOT_FOUND", templateKey: "validation_error" };
  }
  const state = projectVerifiedSyntheticConversationState({ sealedSnapshot, caseAggregate });
  const result = await handler.execute({
    caseId: input.caseId,
    reservationId: randomUUID(),
    estimatedInputTokens: 4_096,
    maximumProviderAttempts: 1,
    intentInput: {
      currentTurn: input.normalizedTurn,
      state,
      focusRefs: [],
    },
  });
  if (!result.ok) {
    return { ok: false, code: result.code, templateKey: result.templateKey };
  }

  const cards: AssistantTurn["cards"][number][] = [];
  if (result.ok && result.kind === "confirmation_required") {
    const pending = await issueLiveMaterialConfirmation(result.candidate);
    if (!pending.ok) throw new Error(pending.code);
    cards.push({
      cardType: "candidate_confirmation" as const,
      cardId: randomUUID(),
      focusRefId: null,
      snapshotId: null,
      priorityClass: "pending_confirmation" as const,
      confirmationId: pending.confirmationId,
      csrfToken: pending.csrfToken,
      candidate: result.candidate,
      expiresAt: pending.expiresAt,
      status: "pending" as const,
      primaryAction: "confirm_and_add" as const,
      canModify: true as const,
    });
  }

  const composed = composer.compose({
    turnId: randomUUID(),
    caseRevision: state.caseRevision,
    snapshotId: state.snapshotId,
    serverTemplateKeys: [result.templateKey],
    explanationSegments: [],
    serverCards: cards,
    availableSourceRefs: [],
    remainingWorkspaceArea: "summary",
  });
  if (!composed.ok) throw new Error(composed.code);
  return { ok: true, turn: AssistantTurnSchema.parse(composed.turn) };
}
