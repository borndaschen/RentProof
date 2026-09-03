import type { EvidenceBudgetDimension, EvidenceBudgetErrorCode } from "./errors";

export type EvidenceBudgetOperationKind =
  "provider_request" | "cache_hit" | "idempotent_reuse" | "fixture" | "pre_provider_rejection";

export interface AnalysisBudgetClock {
  now(): Date;
}

export type EvidenceBudgetTotals = Readonly<{
  providerAttempts: number;
  inputTokens: number;
  outputAndReasoningTokens: number;
}>;

export type EvidenceBudgetCost = Readonly<{
  currency: "USD";
  nanoUsd: string;
  canonicalDecimal: string;
}>;

export type EvidenceBudgetSnapshot = Readonly<{
  caseId: string;
  route: "terra_evidence";
  model: "gpt-5.6-terra";
  startedAt: string;
  updatedAt: string;
  reserved: EvidenceBudgetTotals;
  actual: EvidenceBudgetTotals;
  actualCachedInputTokens: number;
  reservedCost: EvidenceBudgetCost;
  actualCost: EvidenceBudgetCost;
  engineeringAlertReached: boolean;
  unknownUsage: boolean;
  activeReservationCount: number;
}>;

export type ReserveEvidenceBudgetInput = Readonly<{
  operationKind: EvidenceBudgetOperationKind;
  caseId: string;
  reservationId: string;
  model: string;
  maximumProviderAttempts: number;
  maximumInputTokens: number;
  maximumOutputAndReasoningTokens: number;
}>;

export type ReserveEvidenceBudgetResult =
  | Readonly<{
      ok: true;
      metered: false;
      operationKind: Exclude<EvidenceBudgetOperationKind, "provider_request">;
    }>
  | Readonly<{
      ok: true;
      metered: true;
      reservationId: string;
      snapshot: EvidenceBudgetSnapshot;
    }>
  | Readonly<{
      ok: false;
      code: EvidenceBudgetErrorCode;
      dimension?: EvidenceBudgetDimension;
    }>;

export type EvidenceKnownUsage = Readonly<{
  kind: "known";
  actualProviderAttempts: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}>;

export type EvidenceUnknownUsage = Readonly<{
  kind: "unknown";
  actualProviderAttempts: number;
}>;

export type ReconcileEvidenceBudgetInput = Readonly<{
  reservationId: string;
  usage: EvidenceKnownUsage | EvidenceUnknownUsage;
}>;

export type ReconcileEvidenceBudgetResult =
  | Readonly<{
      ok: true;
      reconciliation: "known" | "unknown";
      exceededReservation: boolean;
      snapshot: EvidenceBudgetSnapshot;
    }>
  | Readonly<{ ok: false; code: EvidenceBudgetErrorCode }>;

export interface EvidenceBudgetRepository {
  reserve(input: ReserveEvidenceBudgetInput): Promise<ReserveEvidenceBudgetResult>;
  reconcile(input: ReconcileEvidenceBudgetInput): Promise<ReconcileEvidenceBudgetResult>;
  get(caseId: string): Promise<EvidenceBudgetSnapshot | null>;
}
