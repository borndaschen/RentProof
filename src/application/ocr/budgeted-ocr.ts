import type { EvidenceBudgetRepository } from "@/application/analysis-budget";
import type { ScannedPdfOcrPort } from "./contracts";

/** OCR and contract analysis share the same case budget; unknown usage blocks further calls. */
export class BudgetedScannedPdfOcr implements ScannedPdfOcrPort {
  constructor(
    private readonly provider: ScannedPdfOcrPort,
    private readonly budget: EvidenceBudgetRepository,
    private readonly nextId: () => string,
  ) {}

  async recognize(input: Parameters<ScannedPdfOcrPort["recognize"]>[0]) {
    const reservationId = this.nextId();
    const reserved = await this.budget.reserve({
      operationKind: "provider_request",
      caseId: input.caseId,
      reservationId,
      model: "gpt-5.6-terra",
      maximumProviderAttempts: 1,
      maximumInputTokens: 200_000,
      maximumOutputAndReasoningTokens: 24_000,
    });
    if (!reserved.ok || !reserved.metered) throw new Error("OCR_BUDGET_EXCEEDED");
    let result;
    try {
      result = await this.provider.recognize(input);
    } catch (error) {
      await this.budget.reconcile({
        reservationId,
        usage: { kind: "unknown", actualProviderAttempts: 1 },
      });
      throw error;
    }
    const usage = result.provenance.usage;
    const reconciliation = await this.budget.reconcile({
      reservationId,
      usage: usage?.known
        ? {
            kind: "known",
            actualProviderAttempts: result.provenance.providerAttempts,
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens,
          }
        : { kind: "unknown", actualProviderAttempts: result.provenance.providerAttempts },
    });
    if (!reconciliation.ok || reconciliation.exceededReservation || !usage?.known) {
      throw new Error("OCR_BUDGET_USAGE_UNKNOWN");
    }
    return result;
  }
}
