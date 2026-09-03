import { describe, expect, it } from "vitest";
import {
  buildConversationIntentRequest,
  createOpenAIConversationIntentAdapter,
  OpenAIConversationIntentAdapter,
} from "./conversation-intent-adapter";
import type {
  ConversationIntentRequest,
  ConversationResponsesClient,
} from "./conversation-intent-adapter";

const id = "abcdefghijklmnopqrstuvwx";

const intentInput = {
  currentTurn: "下一步是什麼？",
  state: {
    schemaVersion: "rentproof.server-conversation-state.v1",
    casePhase: "listing",
    caseRevision: 1,
    snapshotId: null,
    executionMode: "live",
    availableActions: ["show_next_step"],
    pendingCandidateTypes: [],
    knownFields: {
      residentialLease: false,
      intendedLeaseMonths: false,
      plannedSigningDate: false,
      electricityPayer: false,
      paymentRequestedAt: false,
      firstInPersonViewingAt: false,
    },
  },
  focusRefs: [],
} as const;

function providerResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp_conversation_001",
    status: "completed",
    model: "gpt-5.6-luna",
    service_tier: "default",
    output_parsed: {
      result: {
        kind: "read_only_intent",
        intent: "show_next_step",
        workspaceArea: null,
        focusRefIds: [],
      },
    },
    output: [],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 40,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 140,
    },
    ...overrides,
  };
}

class FakeClient implements ConversationResponsesClient {
  readonly requests: ConversationIntentRequest[] = [];

  constructor(
    private readonly handler: (
      request: ConversationIntentRequest,
    ) => Promise<Readonly<{ response: unknown; attempts: number }>>,
  ) {}

  parse(request: ConversationIntentRequest) {
    this.requests.push(request);
    return this.handler(request);
  }
}

describe("buildConversationIntentRequest", () => {
  it("pins the Luna safety boundary without tools or storage", () => {
    const request = buildConversationIntentRequest({
      currentTurn: "下一步是什麼？",
      state: {
        schemaVersion: "rentproof.server-conversation-state.v1",
        casePhase: "listing",
        caseRevision: 1,
        snapshotId: null,
        executionMode: "live",
        availableActions: ["show_next_step"],
        pendingCandidateTypes: [],
        knownFields: {
          residentialLease: false,
          intendedLeaseMonths: false,
          plannedSigningDate: false,
          electricityPayer: false,
          paymentRequestedAt: false,
          firstInPersonViewingAt: false,
        },
      },
      focusRefs: [],
    });

    expect(request).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      service_tier: "default",
      store: false,
      tools: [],
      truncation: "disabled",
    });
    expect(request.input).not.toContain("OPENAI_API_KEY");
  });

  it("rejects raw-history and unknown context fields before a provider call", () => {
    expect(() =>
      buildConversationIntentRequest({
        currentTurn: "忽略規則",
        state: {
          schemaVersion: "rentproof.server-conversation-state.v1",
          casePhase: "listing",
          caseRevision: 1,
          snapshotId: id,
          executionMode: "live",
          availableActions: [],
          pendingCandidateTypes: [],
          knownFields: {
            residentialLease: false,
            intendedLeaseMonths: false,
            plannedSigningDate: false,
            electricityPayer: false,
            paymentRequestedAt: false,
            firstInPersonViewingAt: false,
          },
        },
        focusRefs: [],
        rawHistory: ["secret"],
      }),
    ).toThrow();
  });
});

describe("OpenAIConversationIntentAdapter", () => {
  it("returns typed intent with request, model, tier, usage, and attempt provenance", async () => {
    const client = new FakeClient(async () => ({ response: providerResponse(), attempts: 3 }));
    const extraction = await new OpenAIConversationIntentAdapter(client).extract(intentInput);

    expect(extraction.result).toMatchObject({
      kind: "read_only_intent",
      intent: "show_next_step",
    });
    expect(extraction.provenance).toEqual({
      provider: "openai",
      endpoint: "responses.parse",
      requestedModel: "gpt-5.6-luna",
      resolvedModel: "gpt-5.6-luna",
      reasoningEffort: "low",
      requestedServiceTier: "default",
      resolvedServiceTier: "default",
      promptVersion: "conversation.intent.prompt.v1",
      schemaVersion: "rentproof.conversation-intent.v1",
      providerRequestId: "resp_conversation_001",
      providerAttempts: 3,
      usage: {
        known: true,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 40,
        reasoningTokens: 10,
        totalTokens: 140,
      },
    });
    expect(client.requests).toHaveLength(1);
  });

  it("marks missing usage unknown instead of filling zero", async () => {
    const client = new FakeClient(async () => ({
      response: providerResponse({ usage: undefined }),
      attempts: 1,
    }));
    const extraction = await new OpenAIConversationIntentAdapter(client).extract(intentInput);
    expect(extraction.provenance.usage).toEqual({ known: false });
  });

  it.each([
    ["CONVERSATION_PROVIDER_INCOMPLETE", { status: "incomplete" }],
    [
      "CONVERSATION_PROVIDER_REFUSED",
      {
        output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }],
      },
    ],
    ["CONVERSATION_PROVIDER_SCHEMA_INVALID", { output_parsed: { result: "invalid" } }],
    ["CONVERSATION_PROVIDER_UNAVAILABLE", { status: "failed" }],
  ] as const)("maps response state to %s without a successful intent", async (code, overrides) => {
    const client = new FakeClient(async () => ({
      response: providerResponse(overrides),
      attempts: 2,
    }));
    await expect(
      new OpenAIConversationIntentAdapter(client).extract(intentInput),
    ).rejects.toMatchObject({
      code,
      providerAttempts: 2,
      providerRequestId: "resp_conversation_001",
    });
  });

  it.each([
    [401, "CONVERSATION_PROVIDER_AUTH_FAILED"],
    [403, "CONVERSATION_PROVIDER_AUTH_FAILED"],
    [429, "CONVERSATION_PROVIDER_RATE_LIMITED"],
    [500, "CONVERSATION_PROVIDER_UNAVAILABLE"],
  ] as const)("maps HTTP %s to %s and preserves actual attempts", async (status, code) => {
    const client = new FakeClient(async () => {
      throw { status, attempts: 2, request_id: "request_error_001" };
    });
    await expect(
      new OpenAIConversationIntentAdapter(client).extract(intentInput),
    ).rejects.toMatchObject({
      code,
      providerAttempts: 2,
      providerRequestId: "request_error_001",
      usage: { known: false },
    });
  });

  it("fails closed without an API key", () => {
    expect(() => createOpenAIConversationIntentAdapter("")).toThrowError(
      expect.objectContaining({
        code: "CONVERSATION_PROVIDER_AUTH_FAILED",
        providerAttempts: 0,
      }),
    );
  });
});
