import { describe, expect, it, vi } from "vitest";
import { PrepareScannedPdfOcr } from "./prepare-scanned-pdf-ocr";

describe("PrepareScannedPdfOcr", () => {
  it("preflights locally before invoking OCR and returns provenance", async () => {
    const order: string[] = [];
    const useCase = new PrepareScannedPdfOcr(
      {
        inspect: async () => {
          order.push("preflight");
          return { pageCount: 1 };
        },
      },
      {
        recognize: async () => {
          order.push("ocr");
          return {
            output: {
              pages: [
                {
                  page: 1,
                  quality: "clear",
                  lines: [{ text: "租約", confidence: 0.99, bbox: [0, 0, 1, 1] }],
                },
              ],
            },
            provenance: {
              stage: "contract.ocr",
              provider: "fixture",
              requestedModel: "fixture",
              resolvedModel: "fixture",
              promptVersion: "fixture.v1",
              schemaVersion: "fixture.v1",
              providerAttempts: 0,
            },
          };
        },
      },
    );

    const result = await useCase.execute({
      caseId: "case_00000000000000000000",
      artifactId: "artifact_000000000000000",
      bytes: new Uint8Array([1]),
    });
    expect(order).toEqual(["preflight", "ocr"]);
    expect(result.assessment.status).toBe("requires_confirmation");
    expect(result.provenance).toMatchObject({ stage: "contract.ocr", provider: "fixture" });
  });

  it("does not call OCR when preflight rejects the PDF", async () => {
    const recognize = vi.fn();
    const useCase = new PrepareScannedPdfOcr(
      { inspect: async () => Promise.reject(new Error("PDF_ACTIVE_CONTENT_DISALLOWED")) },
      { recognize },
    );
    await expect(
      useCase.execute({ caseId: "case", artifactId: "artifact", bytes: new Uint8Array() }),
    ).rejects.toThrow("PDF_ACTIVE_CONTENT_DISALLOWED");
    expect(recognize).not.toHaveBeenCalled();
  });
});
