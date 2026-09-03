import type { ConversationBudgetDimension, ConversationBudgetErrorCode } from "./errors";

export type ConversationBudgetOperationKind =
  | "provider_request"
  | "fixture"
  | "server_template"
  | "pre_provider_rejection"
  | "idempotent_reuse";

export type ConversationBudgetTotals = Readonly<{
  providerAttempts: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputAndReasoningTokens: number;
}>;

export type ConversationBudgetSnapshot = Readonly<{
  caseId: string;
  windowId: string;
  windowStartedAt: string;
  windowExpiresAt: string;
  reserved: ConversationBudgetTotals;
  actual: ConversationBudgetTotals;
  unknownUsage: boolean;
  activeReservationCount: number;
}>;

export type ReserveConversationBudgetInput = Readonly<{
  operationKind: ConversationBudgetOperationKind;
  caseId: string;
  reservationId: string;
  now: Date;
  maximumProviderAttempts: number;
  maximumInputTokens: number;
  maximumOutputAndReasoningTokens: number;
}>;

export type ReserveConversationBudgetResult =
  | Readonly<{
      ok: true;
      metered: false;
      operationKind: Exclude<ConversationBudgetOperationKind, "provider_request">;
    }>
  | Readonly<{
      ok: true;
      metered: true;
      reservationId: string;
      snapshot: ConversationBudgetSnapshot;
    }>
  | Readonly<{
      ok: false;
      code: ConversationBudgetErrorCode;
      dimension?: ConversationBudgetDimension;
    }>;

export type KnownConversationUsage = Readonly<{
  kind: "known";
  actualProviderAttempts: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}>;

export type UnknownConversationUsage = Readonly<{
  kind: "unknown";
  actualProviderAttempts: number;
}>;

export type ReconcileConversationBudgetInput = Readonly<{
  reservationId: string;
  completedAt: Date;
  usage: KnownConversationUsage | UnknownConversationUsage;
}>;

export type ReconcileConversationBudgetResult =
  | Readonly<{
      ok: true;
      reconciliation: "known" | "unknown";
      exceededReservation: boolean;
      snapshot: ConversationBudgetSnapshot;
    }>
  | Readonly<{
      ok: false;
      code: ConversationBudgetErrorCode;
    }>;

export interface ConversationBudgetRepository {
  reserve(input: ReserveConversationBudgetInput): Promise<ReserveConversationBudgetResult>;
  reconcile(input: ReconcileConversationBudgetInput): Promise<ReconcileConversationBudgetResult>;
  getCurrentWindow(caseId: string, now: Date): Promise<ConversationBudgetSnapshot | null>;
}
