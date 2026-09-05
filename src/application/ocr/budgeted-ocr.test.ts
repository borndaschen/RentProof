import { describe, expect, it, vi } from "vitest";
import { InMemoryEvidenceBudgetRepository } from "@/application/analysis-budget";
import { BudgetedScannedPdfOcr } from "./budgeted-ocr";
import type { ScannedPdfOcrPort } from "./contracts";

const input = {
  caseId: "case_000000000000000001",
  artifactId: "artifact_000000000000001",
  pageCount: 1,
  bytes: Uint8Array.of(1),
};
function setup(known = true) {
  const budget = new InMemoryEvidenceBudgetRepository({ now: () => new Date() });
  const recognize = vi.fn<ScannedPdfOcrPort["recognize"]>(async () => ({
    output: {},
    provenance: {
      stage: "contract.ocr",
      provider: "test",
      requestedModel: "gpt-5.6-terra",
      resolvedModel: "gpt-5.6-terra",
      promptVersion: "test.v1",
      schemaVersion: "test.v1",
      providerAttempts: 1,
      usage: known
        ? {
            known: true,
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 20,
            reasoningTokens: 10,
          }
        : { known: false },
    },
  }));
  let sequence = 0;
  const service = new BudgetedScannedPdfOcr(
    { recognize },
    budget,
    () => `reservation_${String(++sequence).padStart(20, "0")}`,
  );
  return { budget, recognize, service };
}
describe("shared OCR evidence budget", () => {
  it("reconciles the provider attempt and counts output plus reasoning", async () => {
    const { service, budget } = setup();
    await service.recognize(input);
    expect(await budget.get(input.caseId)).toMatchObject({
      actual: { providerAttempts: 1, inputTokens: 100, outputAndReasoningTokens: 30 },
      activeReservationCount: 0,
    });
  });
  it("stops after unknown usage without another provider request", async () => {
    const { service, recognize } = setup(false);
    await expect(service.recognize(input)).rejects.toThrow("OCR_BUDGET_USAGE_UNKNOWN");
    await expect(service.recognize(input)).rejects.toThrow("OCR_BUDGET_EXCEEDED");
    expect(recognize).toHaveBeenCalledTimes(1);
  });
  it("preserves refusal reason and reconciles an unknown failed attempt", async () => {
    const { service, recognize, budget } = setup();
    recognize.mockRejectedValueOnce(new Error("OCR_PROVIDER_REFUSED"));
    await expect(service.recognize(input)).rejects.toThrow("OCR_PROVIDER_REFUSED");
    expect(await budget.get(input.caseId)).toMatchObject({
      unknownUsage: true,
      actual: { providerAttempts: 1 },
    });
  });
  it("refuses concurrent work that exceeds the case reservation", async () => {
    const { service, recognize, budget } = setup();
    await budget.reserve({
      operationKind: "provider_request",
      caseId: input.caseId,
      reservationId: "reservation_existing_00001",
      model: "gpt-5.6-terra",
      maximumProviderAttempts: 1,
      maximumInputTokens: 400_000,
      maximumOutputAndReasoningTokens: 40_000,
    });
    await expect(service.recognize(input)).rejects.toThrow("OCR_BUDGET_EXCEEDED");
    expect(recognize).not.toHaveBeenCalled();
  });
});
