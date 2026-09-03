import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

export const LIVE_SMOKE_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;

type LiveSmokeModel = (typeof LIVE_SMOKE_MODELS)[number];

const ProbeEnvelopeSchema = z.object({ result: z.literal("ok") }).strict();

const ProviderResponseSchema = z
  .object({
    status: z.enum(["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"]),
    model: z.string().min(1).max(128),
    service_tier: z.string().min(1).max(64).nullable().optional(),
    output_parsed: z.unknown().nullable(),
    output: z.array(z.unknown()),
    usage: z.unknown().optional(),
  })
  .passthrough();

const UsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    output_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative() })
      .passthrough(),
    total_tokens: z.number().int().nonnegative(),
  })
  .passthrough();

export type LiveSmokeReasonCode =
  | "LIVE_SMOKE_OK"
  | "LIVE_SMOKE_AUTH_FAILED"
  | "LIVE_SMOKE_RATE_LIMITED"
  | "LIVE_SMOKE_MODEL_UNAVAILABLE"
  | "LIVE_SMOKE_INCOMPLETE"
  | "LIVE_SMOKE_REFUSED"
  | "LIVE_SMOKE_SCHEMA_INVALID"
  | "LIVE_SMOKE_USAGE_UNKNOWN"
  | "LIVE_SMOKE_TIER_MISMATCH"
  | "LIVE_SMOKE_MODEL_MISMATCH"
  | "LIVE_SMOKE_PROVIDER_UNAVAILABLE";

export type LiveSmokeResult = Readonly<{
  model: LiveSmokeModel;
  status: string;
  requestedTier: "default";
  resolvedTier: string | null;
  usage: Readonly<{
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  }> | null;
  reasonCode: LiveSmokeReasonCode;
}>;

function buildRequest(model: LiveSmokeModel) {
  return {
    model,
    reasoning: { effort: model === "gpt-5.6-luna" ? ("low" as const) : ("medium" as const) },
    service_tier: "default" as const,
    store: false as const,
    tools: [],
    truncation: "disabled" as const,
    max_output_tokens: 128,
    instructions:
      "Return the exact strict probe object. This is a synthetic connectivity check. Do not add text.",
    input: "Return the synthetic connectivity probe result.",
    text: {
      format: zodTextFormat(
        ProbeEnvelopeSchema,
        `rentproof_${model.replaceAll(/[^A-Za-z0-9_-]/gu, "_")}_smoke_v1`,
      ),
    },
  };
}

export type LiveSmokeRequest = ReturnType<typeof buildRequest>;

export interface LiveSmokeResponsesClient {
  parse(request: LiveSmokeRequest): Promise<unknown>;
}

function hasRefusal(output: readonly unknown[]): boolean {
  return output.some((item) => {
    if (typeof item !== "object" || item === null) return false;
    const record = item as Record<string, unknown>;
    if (record["type"] !== "message" || !Array.isArray(record["content"])) return false;
    return record["content"].some(
      (content) =>
        typeof content === "object" &&
        content !== null &&
        (content as Record<string, unknown>)["type"] === "refusal",
    );
  });
}

function failure(
  model: LiveSmokeModel,
  reasonCode: LiveSmokeReasonCode,
  status = "request_failed",
  resolvedTier: string | null = null,
): LiveSmokeResult {
  return { model, status, requestedTier: "default", resolvedTier, usage: null, reasonCode };
}

function classifyThrownError(error: unknown): LiveSmokeReasonCode {
  if (typeof error !== "object" || error === null) return "LIVE_SMOKE_PROVIDER_UNAVAILABLE";
  const status = (error as Record<string, unknown>)["status"];
  if (status === 401 || status === 403) return "LIVE_SMOKE_AUTH_FAILED";
  if (status === 404) return "LIVE_SMOKE_MODEL_UNAVAILABLE";
  if (status === 429) return "LIVE_SMOKE_RATE_LIMITED";
  return "LIVE_SMOKE_PROVIDER_UNAVAILABLE";
}

export class OpenAILiveSmokeRunner {
  readonly #client: LiveSmokeResponsesClient;

  constructor(client: LiveSmokeResponsesClient) {
    this.#client = client;
  }

  async run(): Promise<readonly LiveSmokeResult[]> {
    return Promise.all(LIVE_SMOKE_MODELS.map(async (model) => this.#probe(model)));
  }

  async #probe(model: LiveSmokeModel): Promise<LiveSmokeResult> {
    let rawResponse: unknown;
    try {
      rawResponse = await this.#client.parse(buildRequest(model));
    } catch (error) {
      return failure(model, classifyThrownError(error));
    }

    const parsed = ProviderResponseSchema.safeParse(rawResponse);
    if (!parsed.success) return failure(model, "LIVE_SMOKE_SCHEMA_INVALID", "schema_invalid");
    const response = parsed.data;
    const resolvedTier = response.service_tier ?? null;
    if (response.status === "incomplete") {
      return failure(model, "LIVE_SMOKE_INCOMPLETE", response.status, resolvedTier);
    }
    if (hasRefusal(response.output)) {
      return failure(model, "LIVE_SMOKE_REFUSED", response.status, resolvedTier);
    }
    if (response.status !== "completed") {
      return failure(model, "LIVE_SMOKE_PROVIDER_UNAVAILABLE", response.status, resolvedTier);
    }
    if (response.model !== model) {
      return failure(model, "LIVE_SMOKE_MODEL_MISMATCH", response.status, resolvedTier);
    }
    if (resolvedTier !== "default") {
      return failure(model, "LIVE_SMOKE_TIER_MISMATCH", response.status, resolvedTier);
    }
    if (!ProbeEnvelopeSchema.safeParse(response.output_parsed).success) {
      return failure(model, "LIVE_SMOKE_SCHEMA_INVALID", response.status, resolvedTier);
    }
    const usage = UsageSchema.safeParse(response.usage);
    if (!usage.success) {
      return failure(model, "LIVE_SMOKE_USAGE_UNKNOWN", response.status, resolvedTier);
    }

    return {
      model,
      status: response.status,
      requestedTier: "default",
      resolvedTier,
      usage: {
        inputTokens: usage.data.input_tokens,
        outputTokens: usage.data.output_tokens,
        reasoningTokens: usage.data.output_tokens_details.reasoning_tokens,
        totalTokens: usage.data.total_tokens,
      },
      reasonCode: "LIVE_SMOKE_OK",
    };
  }
}

export function createOpenAILiveSmokeRunner(apiKey: string): OpenAILiveSmokeRunner {
  if (!apiKey) throw new Error("LIVE_SMOKE_AUTH_FAILED");
  const openai = new OpenAI({ apiKey, maxRetries: 0 });
  return new OpenAILiveSmokeRunner({
    async parse(request) {
      return openai.responses.parse(request);
    },
  });
}
