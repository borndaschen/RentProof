import { describe, expect, it } from "vitest";
import { ConversationProviderError } from "@/adapters/openai/conversation-intent-adapter";
import type {
  ConversationIntentExtraction,
  ConversationProviderUsage,
  OpenAIConversationIntentAdapter,
} from "@/adapters/openai/conversation-intent-adapter";
import { InMemoryConversationBudgetRepository } from "@/application/conversation/budget";
import {
  InMemoryLiveConversationCaseLease,
  LiveConversationHandler,
} from "./live-conversation-handler";
import type { LiveConversationClock } from "./live-conversation-handler";

const caseId = "case_live_conversation_001";

function reservationId(sequence = 1): string {
  return `live_reservation_${String(sequence).padStart(10, "0")}`;
}

const intentInput = {
  currentTurn: "下一步是什麼？",
  state: {
    schemaVersion: "rentproof.server-conversation-state.v1",
    casePhase: "listing",
    caseRevision: 1,
    snapshotId: null,
    executionMode: "live",
    availableActions: ["show_next_step"],
    pendingCandidateTypes: [],
    knownFields: {
      residentialLease: false,
      intendedLeaseMonths: false,
      plannedSigningDate: false,
      electricityPayer: false,
      paymentRequestedAt: false,
      firstInPersonViewingAt: false,
    },
  },
  focusRefs: [],
} as const;

class FixedClock implements LiveConversationClock {
  now(): Date {
    return new Date("2026-09-02T08:00:00.000Z");
  }
}

function provenance(
  usage: ConversationProviderUsage = {
    known: true,
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 40,
    reasoningTokens: 10,
    totalTokens: 140,
  },
) {
  return {
    provider: "openai" as const,
    endpoint: "responses.parse" as const,
    requestedModel: "gpt-5.6-luna" as const,
    resolvedModel: "gpt-5.6-luna",
    reasoningEffort: "low" as const,
    requestedServiceTier: "default" as const,
    resolvedServiceTier: "default",
    promptVersion: "conversation.intent.prompt.v1" as const,
    schemaVersion: "rentproof.conversation-intent.v1" as const,
    providerRequestId: "response_live_001",
    providerAttempts: 1,
    usage,
  };
}

class FakeAdapter implements Pick<OpenAIConversationIntentAdapter, "extract"> {
  calls = 0;

  constructor(private readonly handler: () => Promise<ConversationIntentExtraction>) {}

  extract(): Promise<ConversationIntentExtraction> {
    this.calls += 1;
    return this.handler();
  }
}

function command(sequence = 1) {
  return {
    caseId,
    reservationId: reservationId(sequence),
    estimatedInputTokens: 500,
    maximumProviderAttempts: 1,
    intentInput,
  };
}

function createHandler(adapter: FakeAdapter, lease = new InMemoryLiveConversationCaseLease()) {
  const clock = new FixedClock();
  const budget = new InMemoryConversationBudgetRepository();
  const handler = new LiveConversationHandler({ adapter, budget, lease, clock });
  return { handler, budget, clock };
}

describe("LiveConversationHandler", () => {
  it("returns only a typed read-only result and reconciles known usage", async () => {
    const adapter = new FakeAdapter(async () => ({
      result: {
        kind: "read_only_intent",
        intent: "show_next_step",
        workspaceArea: null,
        focusRefIds: [],
      },
      provenance: provenance(),
    }));
    const { handler, budget, clock } = createHandler(adapter);
    const result = await handler.execute(command());

    expect(result).toMatchObject({
      ok: true,
      kind: "read_only",
      templateKey: "next_step",
      intent: { intent: "show_next_step" },
    });
    const current = await budget.getCurrentWindow(caseId, clock.now());
    expect(current).toMatchObject({
      actual: {
        providerAttempts: 1,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputAndReasoningTokens: 50,
      },
      activeReservationCount: 0,
    });
  });

  it("returns material data only as confirmation-required and never applies state", async () => {
    const candidate = {
      candidateType: "update_case_profile" as const,
      changes: [
        {
          field: "electricity_payer" as const,
          value: { status: "known" as const, value: "tenant" as const },
        },
      ],
    };
    const adapter = new FakeAdapter(async () => ({
      result: { kind: "material_candidate", candidate },
      provenance: provenance(),
    }));
    const { handler } = createHandler(adapter);
    await expect(handler.execute(command())).resolves.toMatchObject({
      ok: true,
      kind: "confirmation_required",
      templateKey: "clarification",
      candidate,
    });
  });

  it("uses fixed clarification and rejection templates", async () => {
    const clarification = new FakeAdapter(async () => ({
      result: {
        kind: "clarification_needed",
        reason: "intent_ambiguous",
        questionKey: "clarify_intent",
      },
      provenance: provenance(),
    }));
    await expect(createHandler(clarification).handler.execute(command())).resolves.toMatchObject({
      ok: true,
      kind: "clarification",
      templateKey: "clarification",
      questionKey: "clarify_intent",
    });

    const rejected = new FakeAdapter(async () => ({
      result: { kind: "rejected", reason: "attempted_stage_control" },
      provenance: provenance(),
    }));
    await expect(createHandler(rejected).handler.execute(command())).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_INTENT_REJECTED",
      templateKey: "validation_error",
    });
  });

  it("reconciles provider failure attempts as unknown and does not return success", async () => {
    const adapter = new FakeAdapter(async () => {
      throw new ConversationProviderError(
        "CONVERSATION_PROVIDER_REFUSED",
        1,
        "response_refused_001",
        { known: false },
      );
    });
    const { handler, budget, clock } = createHandler(adapter);
    await expect(handler.execute(command())).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_PROVIDER_REFUSED",
      templateKey: "provider_error",
    });
    expect(await budget.getCurrentWindow(caseId, clock.now())).toMatchObject({
      unknownUsage: true,
      actual: { providerAttempts: 1 },
      activeReservationCount: 0,
    });
    await expect(handler.execute(command(2))).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_USAGE_UNKNOWN",
      templateKey: "validation_error",
    });
    expect(adapter.calls).toBe(1);
  });

  it("enforces one in-flight turn per case", async () => {
    let resolveExtraction: ((value: ConversationIntentExtraction) => void) | undefined;
    const adapter = new FakeAdapter(
      () =>
        new Promise((resolve) => {
          resolveExtraction = resolve;
        }),
    );
    const lease = new InMemoryLiveConversationCaseLease();
    const { handler } = createHandler(adapter, lease);
    const first = handler.execute(command());
    await expect(handler.execute(command(2))).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_TURN_IN_PROGRESS",
      templateKey: "validation_error",
    });
    if (resolveExtraction === undefined) throw new Error("EXTRACTION_NOT_STARTED");
    resolveExtraction({
      result: {
        kind: "read_only_intent",
        intent: "show_next_step",
        workspaceArea: null,
        focusRefIds: [],
      },
      provenance: provenance(),
    });
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("rejects raw history before budget reservation or adapter execution", async () => {
    const adapter = new FakeAdapter(async () => {
      throw new Error("must not execute");
    });
    const { handler, budget, clock } = createHandler(adapter);
    await expect(
      handler.execute({ ...command(), intentInput: { ...intentInput, rawHistory: ["secret"] } }),
    ).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_TURN_PAYLOAD_INVALID",
      templateKey: "validation_error",
    });
    expect(adapter.calls).toBe(0);
    await expect(budget.getCurrentWindow(caseId, clock.now())).resolves.toBeNull();
  });
});
