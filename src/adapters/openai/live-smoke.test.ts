import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OpenAILiveSmokeRunner,
  type LiveSmokeRequest,
  type LiveSmokeResponsesClient,
} from "./live-smoke";

function response(
  model: "gpt-5.6-luna" | "gpt-5.6-terra",
  overrides: Record<string, unknown> = {},
) {
  return {
    status: "completed",
    model,
    service_tier: "default",
    output_parsed: { result: "ok" },
    output: [],
    usage: {
      input_tokens: 20,
      output_tokens: 4,
      output_tokens_details: { reasoning_tokens: model === "gpt-5.6-luna" ? 0 : 2 },
      total_tokens: 24,
    },
    ...overrides,
  };
}

class CapturingClient implements LiveSmokeResponsesClient {
  readonly requests: LiveSmokeRequest[] = [];

  constructor(private readonly handler: (request: LiveSmokeRequest) => unknown) {}

  parse(request: LiveSmokeRequest): Promise<unknown> {
    this.requests.push(request);
    return Promise.resolve(this.handler(request));
  }
}

describe("OpenAILiveSmokeRunner", () => {
  it("checks both fixed models with strict, stateless, default-tier requests", async () => {
    const client = new CapturingClient((request) => response(request.model));
    const results = await new OpenAILiveSmokeRunner(client).run();

    expect(client.requests).toHaveLength(2);
    expect(client.requests.map((request) => request.model)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-terra",
    ]);
    for (const request of client.requests) {
      expect(request).toMatchObject({
        service_tier: "default",
        store: false,
        tools: [],
        truncation: "disabled",
      });
      expect(request.text.format).toMatchObject({ type: "json_schema", strict: true });
      expect(request.text.format.name).toMatch(/^[A-Za-z0-9_-]+$/u);
    }
    expect(results).toEqual([
      {
        model: "gpt-5.6-luna",
        status: "completed",
        requestedTier: "default",
        resolvedTier: "default",
        usage: { inputTokens: 20, outputTokens: 4, reasoningTokens: 0, totalTokens: 24 },
        reasonCode: "LIVE_SMOKE_OK",
      },
      {
        model: "gpt-5.6-terra",
        status: "completed",
        requestedTier: "default",
        resolvedTier: "default",
        usage: { inputTokens: 20, outputTokens: 4, reasoningTokens: 2, totalTokens: 24 },
        reasonCode: "LIVE_SMOKE_OK",
      },
    ]);
  });

  it.each([
    [401, "LIVE_SMOKE_AUTH_FAILED"],
    [403, "LIVE_SMOKE_AUTH_FAILED"],
    [404, "LIVE_SMOKE_MODEL_UNAVAILABLE"],
    [429, "LIVE_SMOKE_RATE_LIMITED"],
    [500, "LIVE_SMOKE_PROVIDER_UNAVAILABLE"],
  ] as const)(
    "classifies provider status %s without exposing provider text",
    async (status, code) => {
      const client = new CapturingClient(() => {
        throw { status, message: "sensitive provider detail must not appear" };
      });
      const results = await new OpenAILiveSmokeRunner(client).run();
      expect(results.every((result) => result.reasonCode === code)).toBe(true);
      expect(JSON.stringify(results)).not.toContain("sensitive provider detail");
    },
  );

  it.each([
    [response("gpt-5.6-luna", { status: "incomplete" }), "LIVE_SMOKE_INCOMPLETE"],
    [
      response("gpt-5.6-luna", {
        output: [{ type: "message", content: [{ type: "refusal", refusal: "private" }] }],
      }),
      "LIVE_SMOKE_REFUSED",
    ],
    [response("gpt-5.6-luna", { output_parsed: { result: "wrong" } }), "LIVE_SMOKE_SCHEMA_INVALID"],
    [response("gpt-5.6-luna", { usage: null }), "LIVE_SMOKE_USAGE_UNKNOWN"],
    [response("gpt-5.6-luna", { service_tier: "priority" }), "LIVE_SMOKE_TIER_MISMATCH"],
    [response("gpt-5.6-luna", { model: "other-model" }), "LIVE_SMOKE_MODEL_MISMATCH"],
  ])("returns a typed failure for invalid provider result %#", async (providerResponse, code) => {
    const client = new CapturingClient((request) =>
      request.model === "gpt-5.6-luna" ? providerResponse : response(request.model),
    );
    const results = await new OpenAILiveSmokeRunner(client).run();
    expect(results[0]?.reasonCode).toBe(code);
    expect(results[0]?.usage).toBeNull();
    expect(JSON.stringify(results)).not.toContain("private");
  });
});

describe("openai-live-smoke CLI opt-in", () => {
  const script = resolve(process.cwd(), "scripts", "openai-live-smoke.mjs");

  it("does not load environment or call a provider without --live", () => {
    const output = execFileSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: "must-not-be-used" },
    });
    expect(JSON.parse(output)).toEqual({
      status: "skipped",
      reasonCode: "LIVE_SMOKE_OPT_IN_REQUIRED",
    });
  });

  it("is always disabled in CI even with every Live flag", () => {
    const output = execFileSync(process.execPath, [script, "--live"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        RENTPROOF_LLM_MODE: "live",
        RENTPROOF_LIVE_SMOKE: "1",
        OPENAI_API_KEY: "must-not-be-used",
      },
    });
    expect(JSON.parse(output)).toEqual({
      status: "skipped",
      reasonCode: "LIVE_SMOKE_DISABLED_IN_CI",
    });
  });
});
