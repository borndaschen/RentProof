import { describe, expect, it } from "vitest";
import { EVIDENCE_BUDGET_LIMITS } from "./constants";
import { calculateTerraCostNanoUsd, formatNanoUsd } from "./cost";
import { InMemoryEvidenceBudgetRepository } from "./in-memory-evidence-budget-repository";
import type {
  AnalysisBudgetClock,
  EvidenceBudgetOperationKind,
  ReconcileEvidenceBudgetInput,
  ReserveEvidenceBudgetInput,
} from "./ports";

const caseId = "case_evidence_budget_0001";

function reservationId(sequence = 1): string {
  return `evidence_reservation_${String(sequence).padStart(8, "0")}`;
}

class MutableClock implements AnalysisBudgetClock {
  #instant = new Date("2026-09-02T07:00:00.000Z");

  now(): Date {
    return new Date(this.#instant);
  }

  set(value: string): void {
    this.#instant = new Date(value);
  }
}

function providerReservation(
  overrides: Partial<ReserveEvidenceBudgetInput> = {},
): ReserveEvidenceBudgetInput {
  return {
    operationKind: "provider_request",
    caseId,
    reservationId: reservationId(),
    model: "gpt-5.6-terra",
    maximumProviderAttempts: 1,
    maximumInputTokens: 10_000,
    maximumOutputAndReasoningTokens: 2_000,
    ...overrides,
  };
}

function knownUsage(
  overrides: Partial<ReconcileEvidenceBudgetInput> = {},
): ReconcileEvidenceBudgetInput {
  return {
    reservationId: reservationId(),
    usage: {
      kind: "known",
      actualProviderAttempts: 1,
      inputTokens: 8_000,
      cachedInputTokens: 2_000,
      outputTokens: 1_000,
      reasoningTokens: 500,
    },
    ...overrides,
  };
}

describe("Terra canonical cost", () => {
  it("uses exact BigInt nano-USD rates for cached, uncached, and output tokens", () => {
    const cost = calculateTerraCostNanoUsd({
      inputTokens: 100,
      cachedInputTokens: 20,
      outputAndReasoningTokens: 50,
    });
    expect(cost).toBe(764_000n);
    expect(formatNanoUsd(cost)).toBe("0.000764000");
    expect(formatNanoUsd(2_000_000_000n)).toBe("2.000000000");
  });

  it("rejects invalid usage and negative costs without floating-point fallback", () => {
    expect(() =>
      calculateTerraCostNanoUsd({
        inputTokens: 10,
        cachedInputTokens: 11,
        outputAndReasoningTokens: 0,
      }),
    ).toThrow("INVALID_TERRA_TOKEN_USAGE");
    expect(() => formatNanoUsd(-1n)).toThrow("NEGATIVE_COST_NOT_ALLOWED");
  });
});

describe("InMemoryEvidenceBudgetRepository", () => {
  it.each<EvidenceBudgetOperationKind>([
    "cache_hit",
    "idempotent_reuse",
    "fixture",
    "pre_provider_rejection",
  ])("does not charge or create a budget for %s", async (operationKind) => {
    const repository = new InMemoryEvidenceBudgetRepository(new MutableClock());
    const result = await repository.reserve(
      providerReservation({
        operationKind,
        reservationId: "not-required-for-unmetered",
        model: "some-other-model",
        maximumProviderAttempts: 16,
        maximumInputTokens: 500_000,
        maximumOutputAndReasoningTokens: 50_000,
      }),
    );
    expect(result).toEqual({ ok: true, metered: false, operationKind });
    await expect(repository.get(caseId)).resolves.toBeNull();
  });

  it("pins the Terra evidence route and rejects fallback models", async () => {
    const repository = new InMemoryEvidenceBudgetRepository(new MutableClock());
    await expect(
      repository.reserve(providerReservation({ model: "gpt-5.6-luna" })),
    ).resolves.toEqual({ ok: false, code: "EVIDENCE_BUDGET_MODEL_NOT_ALLOWED" });
    await expect(repository.get(caseId)).resolves.toBeNull();
  });

  it("atomically permits at most two concurrent provider reservations", async () => {
    const repository = new InMemoryEvidenceBudgetRepository(new MutableClock());
    const results = await Promise.all([
      repository.reserve(providerReservation({ reservationId: reservationId(1) })),
      repository.reserve(providerReservation({ reservationId: reservationId(2) })),
      repository.reserve(providerReservation({ reservationId: reservationId(3) })),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "EVIDENCE_BUDGET_CONCURRENCY_EXCEEDED" },
    ]);
    const current = await repository.get(caseId);
    expect(current?.activeReservationCount).toBe(2);
  });

  it("reserves worst-case usage and reconciles actual SDK attempts, tokens, and exact cost", async () => {
    const clock = new MutableClock();
    const repository = new InMemoryEvidenceBudgetRepository(clock);
    const reserved = await repository.reserve(providerReservation({ maximumProviderAttempts: 3 }));
    expect(reserved).toMatchObject({
      ok: true,
      metered: true,
      snapshot: {
        route: "terra_evidence",
        model: "gpt-5.6-terra",
        startedAt: "2026-09-02T07:00:00.000Z",
        reserved: {
          providerAttempts: 3,
          inputTokens: 10_000,
          outputAndReasoningTokens: 2_000,
        },
        reservedCost: { nanoUsd: "44000000", canonicalDecimal: "0.044000000" },
      },
    });

    clock.set("2026-09-02T07:01:00.000Z");
    const reconciled = await repository.reconcile(
      knownUsage({
        usage: {
          kind: "known",
          actualProviderAttempts: 3,
          inputTokens: 8_000,
          cachedInputTokens: 2_000,
          outputTokens: 1_000,
          reasoningTokens: 500,
        },
      }),
    );
    expect(reconciled).toMatchObject({
      ok: true,
      reconciliation: "known",
      exceededReservation: false,
      snapshot: {
        updatedAt: "2026-09-02T07:01:00.000Z",
        reserved: { providerAttempts: 0, inputTokens: 0, outputAndReasoningTokens: 0 },
        actual: {
          providerAttempts: 3,
          inputTokens: 8_000,
          outputAndReasoningTokens: 1_500,
        },
        actualCachedInputTokens: 2_000,
        actualCost: { nanoUsd: "30400000", canonicalDecimal: "0.030400000" },
      },
    });
  });

  it.each([
    [
      "provider_attempts",
      { maximumProviderAttempts: 16 },
      {
        kind: "known",
        actualProviderAttempts: 16,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
    ],
    [
      "input_tokens",
      { maximumInputTokens: 500_000 },
      {
        kind: "known",
        actualProviderAttempts: 1,
        inputTokens: 500_000,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
    ],
    [
      "output_and_reasoning_tokens",
      { maximumOutputAndReasoningTokens: 50_000 },
      {
        kind: "known",
        actualProviderAttempts: 1,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 40_000,
        reasoningTokens: 10_000,
      },
    ],
  ] as const)("stops new stages at the %s hard cap", async (dimension, maximum, usage) => {
    const repository = new InMemoryEvidenceBudgetRepository(new MutableClock());
    await repository.reserve(providerReservation(maximum));
    await repository.reconcile(knownUsage({ usage }));
    await expect(
      repository.reserve(providerReservation({ reservationId: reservationId(2) })),
    ).resolves.toEqual({
      ok: false,
      code: "EVIDENCE_BUDGET_EXCEEDED",
      dimension,
    });
  });

  it("marks unknown usage without filling token fields with fabricated values and fails closed", async () => {
    const repository = new InMemoryEvidenceBudgetRepository(new MutableClock());
    await repository.reserve(providerReservation());
    const result = await repository.reconcile({
      reservationId: reservationId(),
      usage: { kind: "unknown", actualProviderAttempts: 2 },
    });
    expect(result).toMatchObject({
      ok: true,
      reconciliation: "unknown",
      snapshot: {
        unknownUsage: true,
        actual: {
          providerAttempts: 2,
          inputTokens: 0,
          outputAndReasoningTokens: 0,
        },
      },
    });
    await expect(
      repository.reserve(providerReservation({ reservationId: reservationId(2) })),
    ).resolves.toEqual({ ok: false, code: "EVIDENCE_BUDGET_USAGE_UNKNOWN" });
  });

  it("stops new stages after the US$2 engineering alert is reached", async () => {
    const repository = new InMemoryEvidenceBudgetRepository(new MutableClock());
    await repository.reserve(providerReservation());
    const result = await repository.reconcile(
      knownUsage({
        usage: {
          kind: "known",
          actualProviderAttempts: 1,
          inputTokens: 500_000,
          cachedInputTokens: 0,
          outputTokens: 100_000,
          reasoningTokens: 0,
        },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      exceededReservation: true,
      snapshot: {
        engineeringAlertReached: true,
        actualCost: { canonicalDecimal: "2.200000000" },
      },
    });
    await expect(
      repository.reserve(providerReservation({ reservationId: reservationId(2) })),
    ).resolves.toEqual({ ok: false, code: "EVIDENCE_BUDGET_ENGINEERING_ALERT" });
  });

  it("keeps an invalid reconciliation reserved, then atomically reconciles only once", async () => {
    const repository = new InMemoryEvidenceBudgetRepository(new MutableClock());
    await repository.reserve(providerReservation());
    await expect(
      repository.reconcile(
        knownUsage({
          usage: {
            kind: "known",
            actualProviderAttempts: 1,
            inputTokens: 10,
            cachedInputTokens: 11,
            outputTokens: 0,
            reasoningTokens: 0,
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "EVIDENCE_BUDGET_INVALID_USAGE" });
    expect((await repository.get(caseId))?.activeReservationCount).toBe(1);

    const results = await Promise.all([
      repository.reconcile(knownUsage()),
      repository.reconcile(knownUsage()),
    ]);
    expect(results.filter((item) => item.ok)).toHaveLength(1);
    expect(results.filter((item) => !item.ok)).toEqual([
      { ok: false, code: "EVIDENCE_BUDGET_RESERVATION_ALREADY_RECONCILED" },
    ]);
  });

  it("rejects invalid and duplicate reservations without changing totals", async () => {
    const repository = new InMemoryEvidenceBudgetRepository(new MutableClock());
    await expect(
      repository.reserve(providerReservation({ maximumProviderAttempts: 0 })),
    ).resolves.toEqual({ ok: false, code: "EVIDENCE_BUDGET_INVALID_USAGE" });
    await repository.reserve(providerReservation());
    await expect(repository.reserve(providerReservation())).resolves.toEqual({
      ok: false,
      code: "EVIDENCE_BUDGET_RESERVATION_CONFLICT",
    });
    await expect(
      repository.reconcile({ reservationId: reservationId(99), usage: knownUsage().usage }),
    ).resolves.toEqual({ ok: false, code: "EVIDENCE_BUDGET_RESERVATION_NOT_FOUND" });
  });

  it("uses the fixed D-037 constants", () => {
    expect(EVIDENCE_BUDGET_LIMITS).toEqual({
      providerAttempts: 16,
      concurrency: 2,
      inputTokens: 500_000,
      outputAndReasoningTokens: 50_000,
      engineeringAlertNanoUsd: 2_000_000_000n,
    });
  });
});
