import { createHash } from "node:crypto";
import { OpaqueIdSchema } from "@/domain/conversation";
import { CONVERSATION_BUDGET_LIMITS } from "./constants";
import type { ConversationBudgetDimension } from "./errors";
import type {
  ConversationBudgetOperationKind,
  ConversationBudgetRepository,
  ConversationBudgetSnapshot,
  ConversationBudgetTotals,
  ReconcileConversationBudgetInput,
  ReconcileConversationBudgetResult,
  ReserveConversationBudgetInput,
  ReserveConversationBudgetResult,
} from "./ports";

type MutableTotals = {
  providerAttempts: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputAndReasoningTokens: number;
};

type Reservation = Readonly<{
  reservationId: string;
  windowId: string;
  maximumProviderAttempts: number;
  maximumInputTokens: number;
  maximumOutputAndReasoningTokens: number;
}>;

type BudgetWindow = {
  caseId: string;
  windowId: string;
  startedAtMs: number;
  expiresAtMs: number;
  reserved: MutableTotals;
  actual: MutableTotals;
  unknownUsage: boolean;
  reservations: Map<string, Reservation>;
};

const ZERO_TOTALS = (): MutableTotals => ({
  providerAttempts: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputAndReasoningTokens: 0,
});

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateReservationInput(input: ReserveConversationBudgetInput): boolean {
  return (
    Number.isSafeInteger(input.maximumProviderAttempts) &&
    input.maximumProviderAttempts >= 1 &&
    isNonNegativeInteger(input.maximumInputTokens) &&
    isNonNegativeInteger(input.maximumOutputAndReasoningTokens)
  );
}

function cloneTotals(totals: MutableTotals): ConversationBudgetTotals {
  return { ...totals };
}

function toSnapshot(window: BudgetWindow): ConversationBudgetSnapshot {
  return {
    caseId: window.caseId,
    windowId: window.windowId,
    windowStartedAt: new Date(window.startedAtMs).toISOString(),
    windowExpiresAt: new Date(window.expiresAtMs).toISOString(),
    reserved: cloneTotals(window.reserved),
    actual: cloneTotals(window.actual),
    unknownUsage: window.unknownUsage,
    activeReservationCount: window.reservations.size,
  };
}

function findExceededDimension(
  window: BudgetWindow,
  requested: Pick<
    ReserveConversationBudgetInput,
    "maximumProviderAttempts" | "maximumInputTokens" | "maximumOutputAndReasoningTokens"
  >,
): ConversationBudgetDimension | null {
  if (
    window.actual.providerAttempts +
      window.reserved.providerAttempts +
      requested.maximumProviderAttempts >
    CONVERSATION_BUDGET_LIMITS.providerAttempts
  ) {
    return "provider_attempts";
  }

  if (
    window.actual.inputTokens + window.reserved.inputTokens + requested.maximumInputTokens >
    CONVERSATION_BUDGET_LIMITS.inputTokens
  ) {
    return "input_tokens";
  }

  if (
    window.actual.outputAndReasoningTokens +
      window.reserved.outputAndReasoningTokens +
      requested.maximumOutputAndReasoningTokens >
    CONVERSATION_BUDGET_LIMITS.outputAndReasoningTokens
  ) {
    return "output_and_reasoning_tokens";
  }

  return null;
}

function isUnmetered(
  operationKind: ConversationBudgetOperationKind,
): operationKind is Exclude<ConversationBudgetOperationKind, "provider_request"> {
  return operationKind !== "provider_request";
}

function createWindowId(caseId: string, startedAtMs: number): string {
  return createHash("sha256").update(`${caseId}:${startedAtMs}`, "utf8").digest("hex").slice(0, 32);
}

export class InMemoryConversationBudgetRepository implements ConversationBudgetRepository {
  readonly #currentWindows = new Map<string, BudgetWindow>();
  readonly #windowsById = new Map<string, BudgetWindow>();
  readonly #reservations = new Map<string, Reservation>();
  readonly #reconciled = new Set<string>();

  async reserve(input: ReserveConversationBudgetInput): Promise<ReserveConversationBudgetResult> {
    if (isUnmetered(input.operationKind)) {
      return { ok: true, metered: false, operationKind: input.operationKind };
    }

    const parsedCaseId = OpaqueIdSchema.safeParse(input.caseId);
    const parsedReservationId = OpaqueIdSchema.safeParse(input.reservationId);
    if (
      !parsedCaseId.success ||
      !parsedReservationId.success ||
      !Number.isFinite(input.now.getTime()) ||
      !validateReservationInput(input)
    ) {
      return { ok: false, code: "CONVERSATION_BUDGET_INVALID_USAGE" };
    }

    if (this.#reservations.has(input.reservationId) || this.#reconciled.has(input.reservationId)) {
      return { ok: false, code: "CONVERSATION_BUDGET_RESERVATION_CONFLICT" };
    }

    let window = this.#currentWindows.get(input.caseId);
    if (window === undefined || input.now.getTime() >= window.expiresAtMs) {
      window = this.#createWindow(input.caseId, input.now.getTime());
    }

    if (window.unknownUsage) {
      return { ok: false, code: "CONVERSATION_USAGE_UNKNOWN" };
    }

    const dimension = findExceededDimension(window, input);
    if (dimension !== null) {
      return { ok: false, code: "CONVERSATION_BUDGET_EXCEEDED", dimension };
    }

    const reservation: Reservation = {
      reservationId: input.reservationId,
      windowId: window.windowId,
      maximumProviderAttempts: input.maximumProviderAttempts,
      maximumInputTokens: input.maximumInputTokens,
      maximumOutputAndReasoningTokens: input.maximumOutputAndReasoningTokens,
    };

    window.reserved.providerAttempts += input.maximumProviderAttempts;
    window.reserved.inputTokens += input.maximumInputTokens;
    window.reserved.outputAndReasoningTokens += input.maximumOutputAndReasoningTokens;
    window.reservations.set(input.reservationId, reservation);
    this.#reservations.set(input.reservationId, reservation);

    return {
      ok: true,
      metered: true,
      reservationId: input.reservationId,
      snapshot: toSnapshot(window),
    };
  }

  async reconcile(
    input: ReconcileConversationBudgetInput,
  ): Promise<ReconcileConversationBudgetResult> {
    if (this.#reconciled.has(input.reservationId)) {
      return {
        ok: false,
        code: "CONVERSATION_BUDGET_RESERVATION_ALREADY_RECONCILED",
      };
    }

    const reservation = this.#reservations.get(input.reservationId);
    if (reservation === undefined) {
      return { ok: false, code: "CONVERSATION_BUDGET_RESERVATION_NOT_FOUND" };
    }

    const window = this.#windowsById.get(reservation.windowId);
    if (window === undefined || !this.#isValidUsage(input)) {
      return { ok: false, code: "CONVERSATION_BUDGET_INVALID_USAGE" };
    }

    window.reserved.providerAttempts -= reservation.maximumProviderAttempts;
    window.reserved.inputTokens -= reservation.maximumInputTokens;
    window.reserved.outputAndReasoningTokens -= reservation.maximumOutputAndReasoningTokens;
    window.reservations.delete(input.reservationId);
    this.#reservations.delete(input.reservationId);

    const exceededReservation =
      input.usage.actualProviderAttempts > reservation.maximumProviderAttempts ||
      (input.usage.kind === "known" &&
        (input.usage.inputTokens > reservation.maximumInputTokens ||
          input.usage.outputTokens + input.usage.reasoningTokens >
            reservation.maximumOutputAndReasoningTokens));

    window.actual.providerAttempts += input.usage.actualProviderAttempts;
    if (input.usage.kind === "unknown") {
      window.unknownUsage = true;
    } else {
      window.actual.inputTokens += input.usage.inputTokens;
      window.actual.cachedInputTokens += input.usage.cachedInputTokens;
      window.actual.outputAndReasoningTokens +=
        input.usage.outputTokens + input.usage.reasoningTokens;
    }

    this.#reconciled.add(input.reservationId);

    return {
      ok: true,
      reconciliation: input.usage.kind,
      exceededReservation,
      snapshot: toSnapshot(window),
    };
  }

  async getCurrentWindow(caseId: string, now: Date): Promise<ConversationBudgetSnapshot | null> {
    const window = this.#currentWindows.get(caseId);
    if (window === undefined || now.getTime() >= window.expiresAtMs) {
      return null;
    }
    return toSnapshot(window);
  }

  #createWindow(caseId: string, startedAtMs: number): BudgetWindow {
    const window: BudgetWindow = {
      caseId,
      windowId: createWindowId(caseId, startedAtMs),
      startedAtMs,
      expiresAtMs: startedAtMs + CONVERSATION_BUDGET_LIMITS.windowMs,
      reserved: ZERO_TOTALS(),
      actual: ZERO_TOTALS(),
      unknownUsage: false,
      reservations: new Map(),
    };
    this.#currentWindows.set(caseId, window);
    this.#windowsById.set(window.windowId, window);
    return window;
  }

  #isValidUsage(input: ReconcileConversationBudgetInput): boolean {
    if (
      !Number.isFinite(input.completedAt.getTime()) ||
      !Number.isSafeInteger(input.usage.actualProviderAttempts) ||
      input.usage.actualProviderAttempts < 1
    ) {
      return false;
    }
    if (input.usage.kind === "unknown") {
      return true;
    }
    return (
      isNonNegativeInteger(input.usage.inputTokens) &&
      isNonNegativeInteger(input.usage.cachedInputTokens) &&
      input.usage.cachedInputTokens <= input.usage.inputTokens &&
      isNonNegativeInteger(input.usage.outputTokens) &&
      isNonNegativeInteger(input.usage.reasoningTokens) &&
      Number.isSafeInteger(input.usage.outputTokens + input.usage.reasoningTokens)
    );
  }
}
