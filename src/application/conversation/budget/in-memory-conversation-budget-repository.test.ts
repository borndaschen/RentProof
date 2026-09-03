import { describe, expect, it } from "vitest";
import { CONVERSATION_BUDGET_LIMITS } from "./constants";
import { InMemoryConversationBudgetRepository } from "./in-memory-conversation-budget-repository";
import type {
  ConversationBudgetOperationKind,
  ReconcileConversationBudgetInput,
  ReserveConversationBudgetInput,
} from "./ports";

const baseTime = new Date("2026-09-02T05:00:00.000Z");

function caseId(sequence = 1): string {
  return `case_budget_opaque_${String(sequence).padStart(5, "0")}`;
}

function reservationId(sequence = 1): string {
  return `reservation_opaque_${String(sequence).padStart(5, "0")}`;
}

function providerReservation(
  overrides: Partial<ReserveConversationBudgetInput> = {},
): ReserveConversationBudgetInput {
  return {
    operationKind: "provider_request",
    caseId: caseId(),
    reservationId: reservationId(),
    now: baseTime,
    maximumProviderAttempts: 1,
    maximumInputTokens: 2_000,
    maximumOutputAndReasoningTokens: 1_000,
    ...overrides,
  };
}

function knownReconciliation(
  overrides: Partial<ReconcileConversationBudgetInput> = {},
): ReconcileConversationBudgetInput {
  return {
    reservationId: reservationId(),
    completedAt: new Date("2026-09-02T05:00:10.000Z"),
    usage: {
      kind: "known",
      actualProviderAttempts: 1,
      inputTokens: 1_200,
      cachedInputTokens: 200,
      outputTokens: 300,
      reasoningTokens: 100,
    },
    ...overrides,
  };
}

describe("InMemoryConversationBudgetRepository", () => {
  it("starts a fixed non-sliding 24-hour window at the first provider reservation", async () => {
    const repository = new InMemoryConversationBudgetRepository();
    const first = await repository.reserve(providerReservation());
    expect(first).toMatchObject({ ok: true, metered: true });
    if (!first.ok || !first.metered) {
      throw new Error("Expected a metered reservation.");
    }

    expect(first.snapshot.windowStartedAt).toBe("2026-09-02T05:00:00.000Z");
    expect(first.snapshot.windowExpiresAt).toBe("2026-09-03T05:00:00.000Z");

    await repository.reconcile(knownReconciliation());
    const second = await repository.reserve(
      providerReservation({
        reservationId: reservationId(2),
        now: new Date("2026-09-03T04:59:59.999Z"),
      }),
    );
    expect(second).toMatchObject({ ok: true, metered: true });
    if (!second.ok || !second.metered) {
      throw new Error("Expected a second metered reservation.");
    }
    expect(second.snapshot.windowStartedAt).toBe(first.snapshot.windowStartedAt);
    expect(second.snapshot.windowExpiresAt).toBe(first.snapshot.windowExpiresAt);

    const nextWindow = await repository.reserve(
      providerReservation({
        reservationId: reservationId(3),
        now: new Date("2026-09-03T05:00:00.000Z"),
      }),
    );
    expect(nextWindow).toMatchObject({ ok: true, metered: true });
    if (!nextWindow.ok || !nextWindow.metered) {
      throw new Error("Expected a new metered window.");
    }
    expect(nextWindow.snapshot.windowStartedAt).toBe("2026-09-03T05:00:00.000Z");
    expect(nextWindow.snapshot.windowId).not.toBe(first.snapshot.windowId);
  });

  it.each<ConversationBudgetOperationKind>([
    "fixture",
    "server_template",
    "pre_provider_rejection",
    "idempotent_reuse",
  ])("does not create or charge a window for %s", async (operationKind) => {
    const repository = new InMemoryConversationBudgetRepository();
    const result = await repository.reserve(
      providerReservation({
        operationKind,
        reservationId: "not-needed-for-unmetered",
        maximumProviderAttempts: 99,
        maximumInputTokens: 499_999,
        maximumOutputAndReasoningTokens: 99_999,
      }),
    );

    expect(result).toEqual({ ok: true, metered: false, operationKind });
    await expect(repository.getCurrentWindow(caseId(), baseTime)).resolves.toBeNull();
  });

  it("atomically reserves against outstanding reservations", async () => {
    const repository = new InMemoryConversationBudgetRepository();
    const results = await Promise.all([
      repository.reserve(
        providerReservation({
          reservationId: reservationId(1),
          maximumInputTokens: 300_000,
        }),
      ),
      repository.reserve(
        providerReservation({
          reservationId: reservationId(2),
          maximumInputTokens: 300_000,
        }),
      ),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      {
        ok: false,
        code: "CONVERSATION_BUDGET_EXCEEDED",
        dimension: "input_tokens",
      },
    ]);
  });

  it("enforces all three hard-cap dimensions", async () => {
    const attempts = new InMemoryConversationBudgetRepository();
    expect(
      await attempts.reserve(
        providerReservation({
          maximumProviderAttempts: CONVERSATION_BUDGET_LIMITS.providerAttempts,
        }),
      ),
    ).toMatchObject({ ok: true });
    await expect(
      attempts.reserve(providerReservation({ reservationId: reservationId(2) })),
    ).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_BUDGET_EXCEEDED",
      dimension: "provider_attempts",
    });

    const input = new InMemoryConversationBudgetRepository();
    expect(
      await input.reserve(
        providerReservation({ maximumInputTokens: CONVERSATION_BUDGET_LIMITS.inputTokens }),
      ),
    ).toMatchObject({ ok: true });
    await expect(
      input.reserve(
        providerReservation({ reservationId: reservationId(2), maximumInputTokens: 1 }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_BUDGET_EXCEEDED",
      dimension: "input_tokens",
    });

    const output = new InMemoryConversationBudgetRepository();
    expect(
      await output.reserve(
        providerReservation({
          maximumOutputAndReasoningTokens: CONVERSATION_BUDGET_LIMITS.outputAndReasoningTokens,
        }),
      ),
    ).toMatchObject({ ok: true });
    await expect(
      output.reserve(
        providerReservation({
          reservationId: reservationId(2),
          maximumOutputAndReasoningTokens: 1,
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_BUDGET_EXCEEDED",
      dimension: "output_and_reasoning_tokens",
    });
  });

  it("releases the reservation and records known usage including cached input", async () => {
    const repository = new InMemoryConversationBudgetRepository();
    await repository.reserve(providerReservation());

    const result = await repository.reconcile(knownReconciliation());
    expect(result).toMatchObject({
      ok: true,
      reconciliation: "known",
      exceededReservation: false,
      snapshot: {
        reserved: {
          providerAttempts: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputAndReasoningTokens: 0,
        },
        actual: {
          providerAttempts: 1,
          inputTokens: 1_200,
          cachedInputTokens: 200,
          outputAndReasoningTokens: 400,
        },
        unknownUsage: false,
        activeReservationCount: 0,
      },
    });
  });

  it("marks unknown usage without inventing zero token usage and fails closed", async () => {
    const repository = new InMemoryConversationBudgetRepository();
    await repository.reserve(providerReservation());

    const result = await repository.reconcile({
      reservationId: reservationId(),
      completedAt: new Date("2026-09-02T05:00:10.000Z"),
      usage: { kind: "unknown", actualProviderAttempts: 1 },
    });
    expect(result).toMatchObject({
      ok: true,
      reconciliation: "unknown",
      snapshot: {
        actual: { providerAttempts: 1 },
        unknownUsage: true,
      },
    });

    await expect(
      repository.reserve(
        providerReservation({
          reservationId: reservationId(2),
          now: new Date("2026-09-03T04:59:59Z"),
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "CONVERSATION_USAGE_UNKNOWN" });

    await expect(
      repository.reserve(
        providerReservation({
          reservationId: reservationId(3),
          now: new Date("2026-09-03T05:00:00Z"),
        }),
      ),
    ).resolves.toMatchObject({ ok: true, metered: true });
  });

  it("does not mutate a reservation for invalid usage and allows one valid reconciliation", async () => {
    const repository = new InMemoryConversationBudgetRepository();
    await repository.reserve(providerReservation());

    await expect(
      repository.reconcile(
        knownReconciliation({
          usage: {
            kind: "known",
            actualProviderAttempts: 1,
            inputTokens: 10,
            cachedInputTokens: 11,
            outputTokens: 1,
            reasoningTokens: 1,
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "CONVERSATION_BUDGET_INVALID_USAGE" });

    const current = await repository.getCurrentWindow(caseId(), baseTime);
    expect(current?.activeReservationCount).toBe(1);
    await expect(repository.reconcile(knownReconciliation())).resolves.toMatchObject({ ok: true });
    await expect(repository.reconcile(knownReconciliation())).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_BUDGET_RESERVATION_ALREADY_RECONCILED",
    });
  });

  it("atomically reconciles a reservation only once for competing callers", async () => {
    const repository = new InMemoryConversationBudgetRepository();
    await repository.reserve(providerReservation());

    const results = await Promise.all([
      repository.reconcile(knownReconciliation()),
      repository.reconcile(knownReconciliation()),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      {
        ok: false,
        code: "CONVERSATION_BUDGET_RESERVATION_ALREADY_RECONCILED",
      },
    ]);
  });

  it("detects duplicate reservation IDs and reconciliation overshoot", async () => {
    const repository = new InMemoryConversationBudgetRepository();
    await repository.reserve(providerReservation());
    await expect(repository.reserve(providerReservation())).resolves.toEqual({
      ok: false,
      code: "CONVERSATION_BUDGET_RESERVATION_CONFLICT",
    });

    const reconciled = await repository.reconcile(
      knownReconciliation({
        usage: {
          kind: "known",
          actualProviderAttempts: 2,
          inputTokens: 2_001,
          cachedInputTokens: 0,
          outputTokens: 1_001,
          reasoningTokens: 0,
        },
      }),
    );
    expect(reconciled).toMatchObject({ ok: true, exceededReservation: true });
  });
});
