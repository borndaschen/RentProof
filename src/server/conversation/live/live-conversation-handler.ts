import { z } from "zod";
import type {
  ConversationIntentExtraction,
  ConversationProviderProvenance,
  ConversationProviderUsage,
  OpenAIConversationIntentAdapter,
} from "@/adapters/openai/conversation-intent-adapter";
import { ConversationProviderError } from "@/adapters/openai/conversation-intent-adapter";
import type { ConversationBudgetRepository } from "@/application/conversation/budget";
import {
  ConversationIntentInputSchema,
  MaterialCandidatePayloadSchema,
  OpaqueIdSchema,
} from "@/domain/conversation";

export interface LiveConversationClock {
  now(): Date;
}

export interface LiveConversationCaseLease {
  acquire(caseId: string): boolean;
  release(caseId: string): void;
}

export class InMemoryLiveConversationCaseLease implements LiveConversationCaseLease {
  readonly #activeCases = new Set<string>();

  acquire(caseId: string): boolean {
    if (this.#activeCases.has(caseId)) return false;
    this.#activeCases.add(caseId);
    return true;
  }

  release(caseId: string): void {
    this.#activeCases.delete(caseId);
  }
}

const LiveConversationCommandSchema = z
  .object({
    caseId: OpaqueIdSchema,
    reservationId: OpaqueIdSchema,
    estimatedInputTokens: z.number().int().nonnegative().max(500_000),
    maximumProviderAttempts: z.number().int().min(1).max(3),
    intentInput: ConversationIntentInputSchema,
  })
  .strict();

type ReadOnlyIntent = Extract<ConversationIntentExtraction["result"], { kind: "read_only_intent" }>;

export type LiveConversationResult =
  | Readonly<{
      ok: true;
      kind: "read_only";
      templateKey: "next_step";
      intent: ReadOnlyIntent;
      provenance: ConversationProviderProvenance;
    }>
  | Readonly<{
      ok: true;
      kind: "confirmation_required";
      templateKey: "clarification";
      candidate: z.infer<typeof MaterialCandidatePayloadSchema>;
      provenance: ConversationProviderProvenance;
    }>
  | Readonly<{
      ok: true;
      kind: "clarification";
      templateKey: "clarification";
      questionKey: string;
      provenance: ConversationProviderProvenance;
    }>
  | Readonly<{
      ok: false;
      code: string;
      templateKey: "provider_error" | "validation_error";
    }>;

type LiveHandlerDependencies = Readonly<{
  adapter: Pick<OpenAIConversationIntentAdapter, "extract">;
  budget: ConversationBudgetRepository;
  lease: LiveConversationCaseLease;
  clock: LiveConversationClock;
}>;

function reconciliationUsage(usage: ConversationProviderUsage, providerAttempts: number) {
  if (!usage.known) {
    return { kind: "unknown" as const, actualProviderAttempts: providerAttempts };
  }
  return {
    kind: "known" as const,
    actualProviderAttempts: providerAttempts,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
  };
}

export class LiveConversationHandler {
  constructor(private readonly dependencies: LiveHandlerDependencies) {}

  async execute(untrustedCommand: unknown): Promise<LiveConversationResult> {
    const parsed = LiveConversationCommandSchema.safeParse(untrustedCommand);
    if (!parsed.success) {
      return {
        ok: false,
        code: "CONVERSATION_TURN_PAYLOAD_INVALID",
        templateKey: "validation_error",
      };
    }
    const command = parsed.data;
    if (!this.dependencies.lease.acquire(command.caseId)) {
      return {
        ok: false,
        code: "CONVERSATION_TURN_IN_PROGRESS",
        templateKey: "validation_error",
      };
    }

    try {
      const reserved = await this.dependencies.budget.reserve({
        operationKind: "provider_request",
        caseId: command.caseId,
        reservationId: command.reservationId,
        now: this.dependencies.clock.now(),
        maximumProviderAttempts: command.maximumProviderAttempts,
        maximumInputTokens: command.estimatedInputTokens,
        maximumOutputAndReasoningTokens: 2_000,
      });
      if (!reserved.ok || !reserved.metered) {
        return {
          ok: false,
          code: reserved.ok ? "CONVERSATION_BUDGET_CONFIGURATION_INVALID" : reserved.code,
          templateKey: "validation_error",
        };
      }

      let extraction: ConversationIntentExtraction;
      try {
        extraction = await this.dependencies.adapter.extract(command.intentInput);
      } catch (error) {
        if (!(error instanceof ConversationProviderError)) {
          const reconciled = await this.dependencies.budget.reconcile({
            reservationId: command.reservationId,
            completedAt: this.dependencies.clock.now(),
            usage: { kind: "unknown", actualProviderAttempts: 1 },
          });
          return {
            ok: false,
            code: reconciled.ok ? "CONVERSATION_PROVIDER_UNAVAILABLE" : reconciled.code,
            templateKey: "provider_error",
          };
        }

        const reconciled = await this.dependencies.budget.reconcile({
          reservationId: command.reservationId,
          completedAt: this.dependencies.clock.now(),
          usage: reconciliationUsage(error.usage, error.providerAttempts),
        });
        return {
          ok: false,
          code: reconciled.ok ? error.code : reconciled.code,
          templateKey: "provider_error",
        };
      }

      const reconciled = await this.dependencies.budget.reconcile({
        reservationId: command.reservationId,
        completedAt: this.dependencies.clock.now(),
        usage: reconciliationUsage(
          extraction.provenance.usage,
          extraction.provenance.providerAttempts,
        ),
      });
      if (!reconciled.ok) {
        return { ok: false, code: reconciled.code, templateKey: "validation_error" };
      }

      switch (extraction.result.kind) {
        case "read_only_intent":
          return {
            ok: true,
            kind: "read_only",
            templateKey: "next_step",
            intent: extraction.result,
            provenance: extraction.provenance,
          };
        case "material_candidate":
          return {
            ok: true,
            kind: "confirmation_required",
            templateKey: "clarification",
            candidate: extraction.result.candidate,
            provenance: extraction.provenance,
          };
        case "clarification_needed":
          return {
            ok: true,
            kind: "clarification",
            templateKey: "clarification",
            questionKey: extraction.result.questionKey,
            provenance: extraction.provenance,
          };
        case "rejected":
          return {
            ok: false,
            code: "CONVERSATION_INTENT_REJECTED",
            templateKey: "validation_error",
          };
      }
    } finally {
      this.dependencies.lease.release(command.caseId);
    }
  }
}
