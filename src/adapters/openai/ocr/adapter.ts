import OpenAI from "openai";
import { z } from "zod";
import type { ScannedPdfOcrPort } from "@/application/ocr";
import {
  ScannedPdfOcrEnvelopeSchema,
  type OcrProviderProvenance,
  type OcrProviderReasonCode,
  type ScannedPdfOcrSuccess,
} from "./contracts";
import {
  buildScannedPdfOcrRequest,
  OCR_MODEL,
  OCR_PROMPT_VERSION,
  OCR_SCHEMA_VERSION,
  type ScannedPdfOcrRequest,
} from "./request-builder";

export interface OcrResponsesClient {
  parse(request: ScannedPdfOcrRequest): Promise<{ response: unknown; attempts: number }>;
}

export class OpenAIOcrError extends Error {
  constructor(
    readonly code: OcrProviderReasonCode,
    readonly providerAttempts: number,
    readonly providerRequestId: string | null,
  ) {
    super(code);
    this.name = "OpenAIOcrError";
  }
}

const ResponseSchema = z
  .object({
    id: z.string().min(1).max(128),
    status: z.enum(["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"]),
    model: z.string().min(1).max(128),
    service_tier: z.string().min(1).max(64).nullable().optional(),
    output_parsed: z.unknown().nullable(),
    output: z.array(z.unknown()),
  })
  .passthrough();

function hasRefusal(output: readonly unknown[]): boolean {
  return output.some((item) => {
    if (typeof item !== "object" || item === null) return false;
    const content = (item as Record<string, unknown>)["content"];
    return (
      Array.isArray(content) &&
      content.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          (part as Record<string, unknown>)["type"] === "refusal",
      )
    );
  });
}

function providerStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as Record<string, unknown>)["status"];
  return typeof value === "number" ? value : null;
}

function normalizeOutput(output: z.infer<typeof ScannedPdfOcrEnvelopeSchema>): unknown {
  return {
    pages: output.pages.map((page) => ({
      ...page,
      lines: page.lines.map((line) => ({
        ...line,
        bbox: [line.bbox.xMin, line.bbox.yMin, line.bbox.xMax, line.bbox.yMax],
      })),
    })),
  };
}

export class OpenAIScannedPdfOcrAdapter implements ScannedPdfOcrPort {
  constructor(private readonly client: OcrResponsesClient) {}

  async recognize(
    input: Parameters<ScannedPdfOcrPort["recognize"]>[0],
  ): Promise<ScannedPdfOcrSuccess> {
    const request = buildScannedPdfOcrRequest(input);
    let result: { response: unknown; attempts: number };
    try {
      result = await this.client.parse(request);
    } catch (error: unknown) {
      const status = providerStatus(error);
      const code: OcrProviderReasonCode =
        status === 401 || status === 403
          ? "OCR_PROVIDER_AUTH_FAILED"
          : status === 429
            ? "OCR_PROVIDER_RATE_LIMITED"
            : "OCR_PROVIDER_UNAVAILABLE";
      throw new OpenAIOcrError(code, 1, null);
    }

    const response = ResponseSchema.safeParse(result.response);
    if (!response.success || !Number.isSafeInteger(result.attempts) || result.attempts < 1) {
      throw new OpenAIOcrError("OCR_PROVIDER_SCHEMA_INVALID", 1, null);
    }
    if (response.data.status === "incomplete") {
      throw new OpenAIOcrError("OCR_PROVIDER_INCOMPLETE", result.attempts, response.data.id);
    }
    if (hasRefusal(response.data.output)) {
      throw new OpenAIOcrError("OCR_PROVIDER_REFUSED", result.attempts, response.data.id);
    }
    if (response.data.status !== "completed") {
      throw new OpenAIOcrError("OCR_PROVIDER_UNAVAILABLE", result.attempts, response.data.id);
    }
    const output = ScannedPdfOcrEnvelopeSchema.safeParse(response.data.output_parsed);
    if (!output.success) {
      throw new OpenAIOcrError("OCR_PROVIDER_SCHEMA_INVALID", result.attempts, response.data.id);
    }

    const provenance: OcrProviderProvenance = {
      provider: "openai",
      endpoint: "responses.parse",
      stage: "contract.ocr",
      requestedModel: OCR_MODEL,
      resolvedModel: response.data.model,
      reasoningEffort: "medium",
      requestedServiceTier: "default",
      resolvedServiceTier: response.data.service_tier ?? null,
      promptVersion: OCR_PROMPT_VERSION,
      schemaVersion: OCR_SCHEMA_VERSION,
      providerRequestId: response.data.id,
      providerAttempts: result.attempts,
    };
    return { output: normalizeOutput(output.data), provenance };
  }
}

export function createOpenAIScannedPdfOcrAdapter(apiKey: string): OpenAIScannedPdfOcrAdapter {
  if (!apiKey) throw new OpenAIOcrError("OCR_PROVIDER_AUTH_FAILED", 0, null);
  const openai = new OpenAI({ apiKey, maxRetries: 0 });
  return new OpenAIScannedPdfOcrAdapter({
    parse: async (request) => ({ response: await openai.responses.parse(request), attempts: 1 }),
  });
}
