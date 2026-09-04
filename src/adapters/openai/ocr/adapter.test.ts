import { describe, expect, it } from "vitest";
import { OpenAIScannedPdfOcrAdapter } from "./adapter";

const input = {
  caseId: "case_00000000000000000000",
  artifactId: "artifact_000000000000000",
  pageCount: 1,
  bytes: new TextEncoder().encode("%PDF-synthetic"),
};

function response(outputParsed: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "resp_synthetic",
    status: "completed",
    model: "gpt-5.6-terra",
    service_tier: "default",
    output_parsed: outputParsed,
    output: [],
    ...overrides,
  };
}

const validOutput = {
  documentType: "scanned_contract",
  pages: [
    {
      page: 1,
      quality: "clear",
      lines: [
        {
          text: "租金 12,000 元",
          confidence: 0.99,
          bbox: { xMin: 0.1, yMin: 0.2, xMax: 0.8, yMax: 0.3 },
        },
      ],
    },
  ],
};

describe("OpenAIScannedPdfOcrAdapter", () => {
  it("normalizes provider boxes and records immutable routing provenance", async () => {
    const adapter = new OpenAIScannedPdfOcrAdapter({
      parse: async () => ({ response: response(validOutput), attempts: 1 }),
    });
    await expect(adapter.recognize(input)).resolves.toMatchObject({
      output: {
        pages: [
          {
            page: 1,
            lines: [{ bbox: [0.1, 0.2, 0.8, 0.3] }],
          },
        ],
      },
      provenance: {
        stage: "contract.ocr",
        requestedModel: "gpt-5.6-terra",
        reasoningEffort: "medium",
        requestedServiceTier: "default",
        promptVersion: "contract.ocr.prompt.v1",
        schemaVersion: "rentproof.contract-ocr.v1",
      },
    });
  });

  it.each([
    [response(validOutput, { status: "incomplete" }), "OCR_PROVIDER_INCOMPLETE"],
    [
      response(validOutput, {
        output: [{ content: [{ type: "refusal" }] }],
      }),
      "OCR_PROVIDER_REFUSED",
    ],
    [response({ pages: [] }), "OCR_PROVIDER_SCHEMA_INVALID"],
  ])("fails closed for provider outcome", async (providerResponse, code) => {
    const adapter = new OpenAIScannedPdfOcrAdapter({
      parse: async () => ({ response: providerResponse, attempts: 1 }),
    });
    await expect(adapter.recognize(input)).rejects.toEqual(expect.objectContaining({ code }));
  });

  it("maps provider authentication errors without exposing provider text", async () => {
    const adapter = new OpenAIScannedPdfOcrAdapter({
      parse: async () => Promise.reject({ status: 401, message: "secret provider detail" }),
    });
    await expect(adapter.recognize(input)).rejects.toEqual(
      expect.objectContaining({
        code: "OCR_PROVIDER_AUTH_FAILED",
        message: "OCR_PROVIDER_AUTH_FAILED",
      }),
    );
  });
});
