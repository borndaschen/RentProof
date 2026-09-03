import { EVIDENCE_BUDGET_LIMITS } from "./constants";
import { calculateTerraCostNanoUsd, formatNanoUsd } from "./cost";
import type { EvidenceBudgetDimension } from "./errors";
import type {
  AnalysisBudgetClock,
  EvidenceBudgetOperationKind,
  EvidenceBudgetRepository,
  EvidenceBudgetSnapshot,
  EvidenceBudgetTotals,
  ReconcileEvidenceBudgetInput,
  ReconcileEvidenceBudgetResult,
  ReserveEvidenceBudgetInput,
  ReserveEvidenceBudgetResult,
} from "./ports";

type MutableTotals = {
  providerAttempts: number;
  inputTokens: number;
  outputAndReasoningTokens: number;
};

type Reservation = Readonly<{
  reservationId: string;
  caseId: string;
  maximumProviderAttempts: number;
  maximumInputTokens: number;
  maximumOutputAndReasoningTokens: number;
  maximumCostNanoUsd: bigint;
}>;

type CaseBudget = {
  caseId: string;
  startedAt: string;
  updatedAt: string;
  reserved: MutableTotals;
  actual: MutableTotals;
  actualCachedInputTokens: number;
  reservedCostNanoUsd: bigint;
  actualCostNanoUsd: bigint;
  unknownUsage: boolean;
  reservations: Map<string, Reservation>;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/u;

function zeroTotals(): MutableTotals {
  return { providerAttempts: 0, inputTokens: 0, outputAndReasoningTokens: 0 };
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isUnmetered(
  operationKind: EvidenceBudgetOperationKind,
): operationKind is Exclude<EvidenceBudgetOperationKind, "provider_request"> {
  return operationKind !== "provider_request";
}

function costView(nanoUsd: bigint) {
  return {
    currency: "USD" as const,
    nanoUsd: nanoUsd.toString(),
    canonicalDecimal: formatNanoUsd(nanoUsd),
  };
}

function totalsView(totals: MutableTotals): EvidenceBudgetTotals {
  return { ...totals };
}

function snapshot(budget: CaseBudget): EvidenceBudgetSnapshot {
  return {
    caseId: budget.caseId,
    route: "terra_evidence",
    model: "gpt-5.6-terra",
    startedAt: budget.startedAt,
    updatedAt: budget.updatedAt,
    reserved: totalsView(budget.reserved),
    actual: totalsView(budget.actual),
    actualCachedInputTokens: budget.actualCachedInputTokens,
    reservedCost: costView(budget.reservedCostNanoUsd),
    actualCost: costView(budget.actualCostNanoUsd),
    engineeringAlertReached:
      budget.actualCostNanoUsd >= EVIDENCE_BUDGET_LIMITS.engineeringAlertNanoUsd,
    unknownUsage: budget.unknownUsage,
    activeReservationCount: budget.reservations.size,
  };
}

function exceededDimension(
  budget: CaseBudget,
  request: ReserveEvidenceBudgetInput,
): EvidenceBudgetDimension | null {
  if (
    budget.actual.providerAttempts +
      budget.reserved.providerAttempts +
      request.maximumProviderAttempts >
    EVIDENCE_BUDGET_LIMITS.providerAttempts
  ) {
    return "provider_attempts";
  }
  if (
    budget.actual.inputTokens + budget.reserved.inputTokens + request.maximumInputTokens >
    EVIDENCE_BUDGET_LIMITS.inputTokens
  ) {
    return "input_tokens";
  }
  if (
    budget.actual.outputAndReasoningTokens +
      budget.reserved.outputAndReasoningTokens +
      request.maximumOutputAndReasoningTokens >
    EVIDENCE_BUDGET_LIMITS.outputAndReasoningTokens
  ) {
    return "output_and_reasoning_tokens";
  }
  return null;
}

export class InMemoryEvidenceBudgetRepository implements EvidenceBudgetRepository {
  readonly #budgets = new Map<string, CaseBudget>();
  readonly #reservations = new Map<string, Reservation>();
  readonly #reconciled = new Set<string>();

  constructor(private readonly clock: AnalysisBudgetClock) {}

  async reserve(input: ReserveEvidenceBudgetInput): Promise<ReserveEvidenceBudgetResult> {
    if (isUnmetered(input.operationKind)) {
      return { ok: true, metered: false, operationKind: input.operationKind };
    }
    if (input.model !== "gpt-5.6-terra") {
      return { ok: false, code: "EVIDENCE_BUDGET_MODEL_NOT_ALLOWED" };
    }
    if (
      !ID_PATTERN.test(input.caseId) ||
      !ID_PATTERN.test(input.reservationId) ||
      !isPositiveSafeInteger(input.maximumProviderAttempts) ||
      !isNonNegativeSafeInteger(input.maximumInputTokens) ||
      !isNonNegativeSafeInteger(input.maximumOutputAndReasoningTokens)
    ) {
      return { ok: false, code: "EVIDENCE_BUDGET_INVALID_USAGE" };
    }
    if (this.#reservations.has(input.reservationId) || this.#reconciled.has(input.reservationId)) {
      return { ok: false, code: "EVIDENCE_BUDGET_RESERVATION_CONFLICT" };
    }

    const budget = this.#budget(input.caseId);
    if (budget.unknownUsage) {
      return { ok: false, code: "EVIDENCE_BUDGET_USAGE_UNKNOWN" };
    }
    if (budget.actualCostNanoUsd >= EVIDENCE_BUDGET_LIMITS.engineeringAlertNanoUsd) {
      return { ok: false, code: "EVIDENCE_BUDGET_ENGINEERING_ALERT" };
    }
    if (budget.reservations.size >= EVIDENCE_BUDGET_LIMITS.concurrency) {
      return { ok: false, code: "EVIDENCE_BUDGET_CONCURRENCY_EXCEEDED" };
    }
    const dimension = exceededDimension(budget, input);
    if (dimension !== null) {
      return { ok: false, code: "EVIDENCE_BUDGET_EXCEEDED", dimension };
    }

    const maximumCostNanoUsd = calculateTerraCostNanoUsd({
      inputTokens: input.maximumInputTokens,
      cachedInputTokens: 0,
      outputAndReasoningTokens: input.maximumOutputAndReasoningTokens,
    });
    if (
      budget.actualCostNanoUsd + budget.reservedCostNanoUsd + maximumCostNanoUsd >
      EVIDENCE_BUDGET_LIMITS.engineeringAlertNanoUsd
    ) {
      return { ok: false, code: "EVIDENCE_BUDGET_ENGINEERING_ALERT" };
    }

    const reservation: Reservation = {
      reservationId: input.reservationId,
      caseId: input.caseId,
      maximumProviderAttempts: input.maximumProviderAttempts,
      maximumInputTokens: input.maximumInputTokens,
      maximumOutputAndReasoningTokens: input.maximumOutputAndReasoningTokens,
      maximumCostNanoUsd,
    };
    budget.reserved.providerAttempts += input.maximumProviderAttempts;
    budget.reserved.inputTokens += input.maximumInputTokens;
    budget.reserved.outputAndReasoningTokens += input.maximumOutputAndReasoningTokens;
    budget.reservedCostNanoUsd += maximumCostNanoUsd;
    budget.reservations.set(input.reservationId, reservation);
    this.#reservations.set(input.reservationId, reservation);
    budget.updatedAt = this.clock.now().toISOString();
    return {
      ok: true,
      metered: true,
      reservationId: input.reservationId,
      snapshot: snapshot(budget),
    };
  }

  async reconcile(input: ReconcileEvidenceBudgetInput): Promise<ReconcileEvidenceBudgetResult> {
    if (this.#reconciled.has(input.reservationId)) {
      return { ok: false, code: "EVIDENCE_BUDGET_RESERVATION_ALREADY_RECONCILED" };
    }
    const reservation = this.#reservations.get(input.reservationId);
    if (reservation === undefined) {
      return { ok: false, code: "EVIDENCE_BUDGET_RESERVATION_NOT_FOUND" };
    }
    if (!this.#validUsage(input)) {
      return { ok: false, code: "EVIDENCE_BUDGET_INVALID_USAGE" };
    }
    const budget = this.#budgets.get(reservation.caseId);
    if (budget === undefined) {
      return { ok: false, code: "EVIDENCE_BUDGET_RESERVATION_NOT_FOUND" };
    }

    budget.reserved.providerAttempts -= reservation.maximumProviderAttempts;
    budget.reserved.inputTokens -= reservation.maximumInputTokens;
    budget.reserved.outputAndReasoningTokens -= reservation.maximumOutputAndReasoningTokens;
    budget.reservedCostNanoUsd -= reservation.maximumCostNanoUsd;
    budget.reservations.delete(input.reservationId);
    this.#reservations.delete(input.reservationId);

    let exceededReservation =
      input.usage.actualProviderAttempts > reservation.maximumProviderAttempts;
    budget.actual.providerAttempts += input.usage.actualProviderAttempts;
    if (input.usage.kind === "unknown") {
      budget.unknownUsage = true;
    } else {
      const outputAndReasoningTokens = input.usage.outputTokens + input.usage.reasoningTokens;
      exceededReservation =
        exceededReservation ||
        input.usage.inputTokens > reservation.maximumInputTokens ||
        outputAndReasoningTokens > reservation.maximumOutputAndReasoningTokens;
      budget.actual.inputTokens += input.usage.inputTokens;
      budget.actual.outputAndReasoningTokens += outputAndReasoningTokens;
      budget.actualCachedInputTokens += input.usage.cachedInputTokens;
      budget.actualCostNanoUsd += calculateTerraCostNanoUsd({
        inputTokens: input.usage.inputTokens,
        cachedInputTokens: input.usage.cachedInputTokens,
        outputAndReasoningTokens,
      });
    }
    budget.updatedAt = this.clock.now().toISOString();
    this.#reconciled.add(input.reservationId);
    return {
      ok: true,
      reconciliation: input.usage.kind,
      exceededReservation,
      snapshot: snapshot(budget),
    };
  }

  get(caseId: string): Promise<EvidenceBudgetSnapshot | null> {
    const budget = this.#budgets.get(caseId);
    return Promise.resolve(budget === undefined ? null : snapshot(budget));
  }

  #budget(caseId: string): CaseBudget {
    const existing = this.#budgets.get(caseId);
    if (existing !== undefined) return existing;
    const now = this.clock.now().toISOString();
    const created: CaseBudget = {
      caseId,
      startedAt: now,
      updatedAt: now,
      reserved: zeroTotals(),
      actual: zeroTotals(),
      actualCachedInputTokens: 0,
      reservedCostNanoUsd: 0n,
      actualCostNanoUsd: 0n,
      unknownUsage: false,
      reservations: new Map(),
    };
    this.#budgets.set(caseId, created);
    return created;
  }

  #validUsage(input: ReconcileEvidenceBudgetInput): boolean {
    if (!isPositiveSafeInteger(input.usage.actualProviderAttempts)) return false;
    if (input.usage.kind === "unknown") return true;
    return (
      isNonNegativeSafeInteger(input.usage.inputTokens) &&
      isNonNegativeSafeInteger(input.usage.cachedInputTokens) &&
      input.usage.cachedInputTokens <= input.usage.inputTokens &&
      isNonNegativeSafeInteger(input.usage.outputTokens) &&
      isNonNegativeSafeInteger(input.usage.reasoningTokens) &&
      Number.isSafeInteger(input.usage.outputTokens + input.usage.reasoningTokens)
    );
  }
}
