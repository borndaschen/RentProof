import { describe, expect, it } from "vitest";
import { OpenAIAnalysisError, OpenAITerraAnalysisAdapter } from "./adapter";
import type { AnalysisResponsesClient } from "./adapter";
import type { TerraAnalysisInput, TerraAnalysisOutput } from "./contracts";
import { buildTerraAnalysisRequest } from "./request-builder";
import type { TerraAnalysisRequest } from "./request-builder";

const caseId = "case_analysis_opaque_0001";
const listingArtifactId = "listing_analysis_artifact_01";
const evidenceArtifactId = "evidence_analysis_artifact_1";
const contractArtifactId = "contract_analysis_artifact_1";
const interactionArtifactId = "interaction_analysis_art_01";

const inputs = {
  listing: {
    stage: "listing.extract",
    caseId,
    artifact: {
      kind: "text",
      artifactId: listingArtifactId,
      text: "月租12000元，附洗衣機",
    },
  },
  evidence: {
    stage: "evidence.extract",
    caseId,
    images: [{ artifactId: evidenceArtifactId, mime: "image/jpeg", base64: "AA==" }],
  },
  contract: {
    stage: "contract.extract",
    caseId,
    artifactId: contractArtifactId,
    pages: [{ page: 1, text: "電費每度六元。出租人持有期間，專有部分未曾發生非自然死亡。" }],
  },
  interaction: {
    stage: "interaction.extract",
    caseId,
    artifactId: interactionArtifactId,
    synthetic: true,
    text: "第一次看屋前先支付預約金",
  },
} satisfies Record<string, TerraAnalysisInput>;

const outputs = {
  listing: {
    stage: "listing.extract",
    claims: [
      {
        id: "claim_analysis_opaque_0001",
        caseId,
        artifactId: listingArtifactId,
        source: "listing",
        category: "equipment",
        key: "washing_machine",
        rawText: "附洗衣機",
        normalizedValue: { type: "boolean", value: true },
        modelConfidence: 0.95,
        qualityFlags: [],
        locator: {
          type: "text",
          locatorId: "listing_locator_analysis_001",
          artifactId: listingArtifactId,
          start: 9,
          end: 13,
          excerpt: "附洗衣機",
        },
      },
    ],
  },
  evidence: {
    stage: "evidence.extract",
    observations: [
      {
        id: "observation_analysis_opaque1",
        caseId,
        artifactId: evidenceArtifactId,
        key: "wall_discoloration",
        description: "牆面有局部顏色較深區域",
        presence: "observed",
        observedValue: { type: "text", value: "局部顏色較深" },
        modelConfidence: 0.8,
        qualityFlags: [],
        uncertaintyReason: null,
        locator: {
          type: "image",
          locatorId: "evidence_locator_analysis_01",
          artifactId: evidenceArtifactId,
          bbox: [0.1, 0.1, 0.9, 0.9],
        },
      },
    ],
  },
  contract: {
    stage: "contract.extract",
    clauses: [
      {
        id: "clause_analysis_opaque_0001",
        caseId,
        artifactId: contractArtifactId,
        semanticKey: "electricity_unit_rate",
        rawText: "電費每度六元",
        normalizedValue: {
          type: "unit_rate",
          amountMinorPerUnit: 600,
          currency: "TWD",
          unit: "kwh",
        },
        modelConfidence: 0.99,
        qualityFlags: [],
        locator: {
          type: "pdf",
          locatorId: "contract_locator_analysis_01",
          artifactId: contractArtifactId,
          page: 1,
          start: 0,
          end: 7,
          excerpt: "電費每度六元",
        },
      },
    ],
    nonNaturalDeathDisclosureStatements: [
      {
        statementId: "disclosure_analysis_000001",
        subjectScope: "exclusive_area",
        period: "during_owner_holding",
        answer: "no",
        eventTypes: [],
        sourceKind: "contract_clause",
        signedByProvider: false,
        locator: {
          type: "pdf",
          locatorId: "disclosure_locator_analysis1",
          artifactId: contractArtifactId,
          page: 1,
          start: 7,
          end: 29,
          excerpt: "出租人持有期間，專有部分未曾發生非自然死亡。",
        },
      },
    ],
  },
  interaction: {
    stage: "interaction.extract",
    paymentRequestCues: [
      {
        id: "payment_cue_analysis_00001",
        caseId,
        artifactId: interactionArtifactId,
        requestedItem: "reservation_fee",
        amountMinor: null,
        rawExcerpt: "看屋前先支付預約金",
        locator: {
          type: "text",
          locatorId: "interaction_locator_analysis1",
          artifactId: interactionArtifactId,
          start: 3,
          end: 12,
          excerpt: "看屋前先支付預約金",
        },
      },
    ],
    fraudCandidates: {
      remoteViewingArrangement: { status: "not_present" },
      unfamiliarLinkOrCredentialRequest: { status: "not_present" },
      paymentRequest: { status: "not_present" },
      paymentPartyRelationship: { status: "unknown" },
      lettingAuthorityVerification: { status: "unknown" },
      pressureLanguage: { status: "not_present" },
      paymentMethod: { status: "unknown" },
      redirectedAccountVerification: { status: "not_present" },
    },
  },
} satisfies Record<string, TerraAnalysisOutput>;

function toProviderOutput(output: TerraAnalysisOutput): unknown {
  if (output.stage === "contract.extract") {
    return {
      ...output,
      nonNaturalDeathDisclosureStatements: output.nonNaturalDeathDisclosureStatements.map(
        (statement) => ({
          ...statement,
          evidenceKey: "non_natural_death_disclosure",
          caseId,
          artifactId: contractArtifactId,
        }),
      ),
    };
  }
  if (output.stage !== "evidence.extract") return output;
  return {
    ...output,
    observations: output.observations.map((observation) => {
      if (observation.locator.type !== "image") return observation;
      const [xMin, yMin, xMax, yMax] = observation.locator.bbox;
      return {
        ...observation,
        locator: {
          ...observation.locator,
          bbox: { xMin, yMin, xMax, yMax },
        },
      };
    }),
  };
}

function providerResponse(output: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "resp_analysis_0001",
    status: "completed",
    model: "gpt-5.6-terra",
    service_tier: "default",
    output_parsed: output,
    output_text: JSON.stringify(output),
    output: [],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 150,
    },
    ...overrides,
  };
}

class FakeClient implements AnalysisResponsesClient {
  readonly requests: TerraAnalysisRequest[] = [];

  constructor(
    private readonly handler: (
      request: TerraAnalysisRequest,
    ) => Promise<Readonly<{ response: unknown; attempts: number }>>,
  ) {}

  parse(request: TerraAnalysisRequest) {
    this.requests.push(request);
    return this.handler(request);
  }
}

describe("buildTerraAnalysisRequest", () => {
  it.each(Object.values(inputs))(
    "pins Terra, medium, default, no storage or tools for $stage",
    (input) => {
      const request = buildTerraAnalysisRequest(input);
      expect(request).toMatchObject({
        model: "gpt-5.6-terra",
        reasoning: { effort: "medium" },
        service_tier: "default",
        store: false,
        tools: [],
        truncation: "disabled",
      });
      expect(request).not.toHaveProperty("conversation");
      expect(request).not.toHaveProperty("previous_response_id");
      expect(request.instructions).toContain("untrusted data");
      const format = request.text?.format;
      expect(format).toMatchObject({ type: "json_schema", strict: true });
      expect(format && "schema" in format ? format.schema : null).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    },
  );

  it("uses only data URLs for sanitized image bytes and never remote fetching", () => {
    const request = buildTerraAnalysisRequest(inputs.evidence);
    const serialized = JSON.stringify(request.input);
    expect(serialized).toContain("data:image/jpeg;base64,AA==");
    expect(serialized).not.toMatch(/https?:\/\//u);
    expect(serialized).not.toContain("C:\\");
  });

  it("carries bounded video-frame metadata and rejects partial metadata", () => {
    const frameInput = {
      ...inputs.evidence,
      images: [
        {
          artifactId: evidenceArtifactId,
          mime: "image/jpeg" as const,
          base64: "AA==",
          timestampMs: 2_000,
          frameNo: 1,
        },
      ],
    };
    const request = buildTerraAnalysisRequest(frameInput);
    expect(JSON.stringify(request.input)).toContain('\\"timestampMs\\":2000,\\"frameNo\\":1');
    expect(request.instructions).toContain("Return a video locator");
    expect(() =>
      buildTerraAnalysisRequest({
        ...inputs.evidence,
        images: [{ ...inputs.evidence.images[0], timestampMs: 2_000 }],
      }),
    ).toThrow();
    expect(() =>
      buildTerraAnalysisRequest({
        ...inputs.evidence,
        images: [{ ...inputs.evidence.images[0], timestampMs: 30_000, frameNo: 15 }],
      }),
    ).toThrow();
  });

  it("rejects paths, URLs, secrets, and chat history as context fields", () => {
    for (const extra of [
      { rawPath: "C:\\secret\\lease.pdf" },
      { fetchUrl: "https://example.invalid/listing" },
      { apiKey: "sk-secret" },
      { chatHistory: ["prior message"] },
    ]) {
      expect(() => buildTerraAnalysisRequest({ ...inputs.contract, ...extra })).toThrow();
    }
  });

  it("pins the dedicated disclosure extraction boundary in the contract prompt and schema", () => {
    const request = buildTerraAnalysisRequest(inputs.contract);
    expect(request.instructions).toContain("nonNaturalDeathDisclosureStatements");
    expect(request.instructions).toContain("exclusive area");
    expect(request.instructions).toContain("Never create a disclosure statement from listing copy");
    expect(request.instructions).toContain("rumor, news, an address search");
    expect(request.instructions).toContain("contract_clause");
    const format = request.text?.format;
    expect(format && "name" in format ? format.name : null).toBe("rentproof_contract_analysis_v2");
  });
});

describe("OpenAITerraAnalysisAdapter", () => {
  it("normalizes located interaction facts without allowing provider signals or actions", async () => {
    const providerOutput = structuredClone(toProviderOutput(outputs.interaction)) as {
      fraudCandidates: Record<string, unknown>;
    };
    providerOutput.fraudCandidates["pressureLanguage"] = {
      status: "present",
      value: "pay_now_to_reserve",
      locators: [
        {
          type: "text",
          locatorId: "interaction_pressure_locator_01",
          artifactId: interactionArtifactId,
          start: 3,
          end: 12,
          excerpt: "看屋前先支付預約金",
        },
      ],
    };
    const client = new FakeClient(async () => ({
      response: providerResponse(providerOutput),
      attempts: 1,
    }));
    const result = await new OpenAITerraAnalysisAdapter(client).analyze(inputs.interaction);
    expect(result.output).toMatchObject({
      stage: "interaction.extract",
      fraudCandidates: {
        pressureLanguage: {
          status: "present",
          value: "pay_now_to_reserve",
          locatorIds: ["interaction_pressure_locator_01"],
        },
      },
    });
    expect(result.sourceLocators).toContainEqual(
      expect.objectContaining({ locatorId: "interaction_pressure_locator_01" }),
    );

    const pressureCandidate = providerOutput.fraudCandidates["pressureLanguage"] as Record<
      string,
      unknown
    >;
    pressureCandidate["signalId"] = "FRS-006";
    const signalClient = new FakeClient(async () => ({
      response: providerResponse(providerOutput),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(signalClient).analyze(inputs.interaction),
    ).rejects.toMatchObject({ code: "ANALYSIS_PROVIDER_SCHEMA_INVALID" });
  });

  it("requires video-frame observations to preserve the server timestamp and frame number", async () => {
    const frameInput: TerraAnalysisInput = {
      ...inputs.evidence,
      images: [
        {
          artifactId: evidenceArtifactId,
          mime: "image/jpeg",
          base64: "AA==",
          timestampMs: 2_000,
          frameNo: 1,
        },
      ],
    };
    const providerOutput = toProviderOutput(outputs.evidence) as {
      observations: Array<{ locator: Record<string, unknown> }>;
    };
    const observation = providerOutput.observations[0];
    if (observation === undefined) throw new Error("test observation missing");
    observation.locator = {
      type: "video",
      locatorId: "evidence_locator_analysis_01",
      artifactId: evidenceArtifactId,
      timestampMs: 2_000,
      frameNo: 1,
    };
    const validClient = new FakeClient(async () => ({
      response: providerResponse(providerOutput),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(validClient).analyze(frameInput),
    ).resolves.toMatchObject({
      output: {
        observations: [{ locator: { type: "video", timestampMs: 2_000, frameNo: 1 } }],
      },
    });

    observation.locator["timestampMs"] = 2_001;
    const invalidClient = new FakeClient(async () => ({
      response: providerResponse(providerOutput),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(invalidClient).analyze(frameInput),
    ).rejects.toMatchObject({ code: "ANALYSIS_LOCATOR_INVALID" });
  });

  it.each([
    [inputs.listing, outputs.listing],
    [inputs.evidence, outputs.evidence],
    [inputs.contract, outputs.contract],
    [inputs.interaction, outputs.interaction],
  ] as const)(
    "validates %s output and records locator, usage, and all attempts",
    async (input, output) => {
      const client = new FakeClient(async () => ({
        response: providerResponse(toProviderOutput(output)),
        attempts: 3,
      }));
      const result = await new OpenAITerraAnalysisAdapter(client).analyze(input);

      expect(result.output).toEqual(output);
      expect(result.sourceLocators).toHaveLength(input.stage === "contract.extract" ? 2 : 1);
      expect(result.provenance).toMatchObject({
        provider: "openai",
        endpoint: "responses.parse",
        stage: input.stage,
        requestedModel: "gpt-5.6-terra",
        resolvedModel: "gpt-5.6-terra",
        reasoningEffort: "medium",
        requestedServiceTier: "default",
        resolvedServiceTier: "default",
        providerRequestId: "resp_analysis_0001",
        providerAttempts: 3,
        usage: {
          known: true,
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 50,
          reasoningTokens: 10,
          totalTokens: 150,
        },
      });
      expect(client.requests).toHaveLength(1);
    },
  );

  it("falls back to output_text JSON but never to unvalidated prose", async () => {
    const client = new FakeClient(async () => ({
      response: providerResponse(outputs.listing, {
        output_parsed: null,
        output_text: JSON.stringify(outputs.listing),
      }),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(client).analyze(inputs.listing),
    ).resolves.toMatchObject({
      output: outputs.listing,
    });

    const prose = new FakeClient(async () => ({
      response: providerResponse(outputs.listing, {
        output_parsed: null,
        output_text: "Looks fine",
      }),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(prose).analyze(inputs.listing),
    ).rejects.toMatchObject({
      code: "ANALYSIS_PROVIDER_SCHEMA_INVALID",
    });
  });

  it.each([
    ["ANALYSIS_PROVIDER_INCOMPLETE", { status: "incomplete", output: [] }],
    [
      "ANALYSIS_PROVIDER_REFUSED",
      {
        output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }],
      },
    ],
    ["ANALYSIS_PROVIDER_UNAVAILABLE", { status: "failed" }],
  ] as const)("maps provider response state to %s", async (code, overrides) => {
    const client = new FakeClient(async () => ({
      response: providerResponse(outputs.listing, overrides),
      attempts: 2,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(client).analyze(inputs.listing),
    ).rejects.toMatchObject({
      code,
      providerAttempts: 2,
      providerRequestId: "resp_analysis_0001",
    });
  });

  it("distinguishes schema and locator failures", async () => {
    const schemaClient = new FakeClient(async () => ({
      response: providerResponse(outputs.listing, {
        output_parsed: { stage: "listing.extract", claims: "not-an-array" },
      }),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(schemaClient).analyze(inputs.listing),
    ).rejects.toMatchObject({ code: "ANALYSIS_PROVIDER_SCHEMA_INVALID" });

    const invalidLocator = structuredClone(outputs.listing);
    const firstClaim = invalidLocator.claims.at(0);
    if (firstClaim === undefined) throw new Error("LISTING_FIXTURE_CLAIM_MISSING");
    firstClaim.locator.end = firstClaim.locator.start;
    const locatorClient = new FakeClient(async () => ({
      response: providerResponse(invalidLocator),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(locatorClient).analyze(inputs.listing),
    ).rejects.toMatchObject({ code: "ANALYSIS_LOCATOR_INVALID" });
  });

  it("requires listing text locators to match the captured page text exactly", async () => {
    const invalid = structuredClone(outputs.listing);
    const claim = invalid.claims.at(0);
    if (!claim) throw new Error("CLAIM_MISSING");
    claim.locator.excerpt = "不存在的文字";
    const client = new FakeClient(async () => ({
      response: providerResponse(invalid),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(client).analyze(inputs.listing),
    ).rejects.toMatchObject({
      code: "ANALYSIS_LOCATOR_INVALID",
    });
  });

  it("keeps image listing locators on the existing ownership path", async () => {
    const input = {
      stage: "listing.extract",
      caseId,
      artifact: {
        kind: "image",
        image: { artifactId: listingArtifactId, mime: "image/jpeg", base64: "AA==" },
      },
    } as const;
    const baseClaim = outputs.listing.claims.at(0);
    if (!baseClaim) throw new Error("CLAIM_MISSING");
    const output = {
      stage: "listing.extract" as const,
      claims: [
        {
          ...baseClaim,
          locator: {
            type: "image" as const,
            locatorId: "listing_locator_analysis_001",
            artifactId: listingArtifactId,
            bbox: { xMin: 0.1, yMin: 0.1, xMax: 0.9, yMax: 0.9 },
          },
        },
      ],
    };
    const client = new FakeClient(async () => ({
      response: providerResponse(output),
      attempts: 1,
    }));
    await expect(new OpenAITerraAnalysisAdapter(client).analyze(input)).resolves.toMatchObject({
      output: { stage: "listing.extract" },
    });
  });

  it("maps only explicit, located contract disclosure statements into the domain shape", async () => {
    const client = new FakeClient(async () => ({
      response: providerResponse(toProviderOutput(outputs.contract)),
      attempts: 1,
    }));
    const result = await new OpenAITerraAnalysisAdapter(client).analyze(inputs.contract);
    if (result.output.stage !== "contract.extract") throw new Error("CONTRACT_OUTPUT_REQUIRED");

    expect(result.output.nonNaturalDeathDisclosureStatements).toEqual([
      {
        statementId: "disclosure_analysis_000001",
        subjectScope: "exclusive_area",
        period: "during_owner_holding",
        answer: "no",
        eventTypes: [],
        sourceKind: "contract_clause",
        signedByProvider: false,
        locator: outputs.contract.nonNaturalDeathDisclosureStatements[0]?.locator,
      },
    ]);
    expect(result.output.nonNaturalDeathDisclosureStatements[0]).not.toHaveProperty("caseId");
    expect(result.output.nonNaturalDeathDisclosureStatements[0]).not.toHaveProperty("artifactId");
  });

  it.each([
    ["rumor source", { sourceKind: "rumor" }, "ANALYSIS_PROVIDER_SCHEMA_INVALID"],
    ["address-search source", { sourceKind: "address_search" }, "ANALYSIS_PROVIDER_SCHEMA_INVALID"],
    ["news source", { sourceKind: "news_report" }, "ANALYSIS_PROVIDER_SCHEMA_INVALID"],
    ["model inference", { sourceKind: "model_inference" }, "ANALYSIS_PROVIDER_SCHEMA_INVALID"],
    [
      "non-exclusive scope",
      { subjectScope: "entire_building" },
      "ANALYSIS_PROVIDER_SCHEMA_INVALID",
    ],
    [
      "unsigned status form",
      { sourceKind: "signed_status_confirmation" },
      "ANALYSIS_PROVIDER_SCHEMA_INVALID",
    ],
  ] as const)("rejects disclosure candidate from %s", async (_label, overrides, code) => {
    const provider = toProviderOutput(outputs.contract) as {
      nonNaturalDeathDisclosureStatements: Array<Record<string, unknown>>;
    };
    const statement = provider.nonNaturalDeathDisclosureStatements[0];
    if (statement === undefined) throw new Error("DISCLOSURE_FIXTURE_REQUIRED");
    Object.assign(statement, overrides);
    const client = new FakeClient(async () => ({
      response: providerResponse(provider),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(client).analyze(inputs.contract),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    ["wrong actor case", { caseId: "case_cross_owner_0000001" }],
    ["wrong artifact", { artifactId: "contract_cross_case_00001" }],
  ] as const)("rejects disclosure locator ownership: %s", async (_label, overrides) => {
    const provider = toProviderOutput(outputs.contract) as {
      nonNaturalDeathDisclosureStatements: Array<Record<string, unknown>>;
    };
    const statement = provider.nonNaturalDeathDisclosureStatements[0];
    if (statement === undefined) throw new Error("DISCLOSURE_FIXTURE_REQUIRED");
    Object.assign(statement, overrides);
    const client = new FakeClient(async () => ({
      response: providerResponse(provider),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(client).analyze(inputs.contract),
    ).rejects.toMatchObject({ code: "ANALYSIS_LOCATOR_INVALID" });
  });

  it("rejects a disclosure excerpt that does not exactly match supplied page code points", async () => {
    const provider = toProviderOutput(outputs.contract) as {
      nonNaturalDeathDisclosureStatements: Array<{ locator: Record<string, unknown> }>;
    };
    const statement = provider.nonNaturalDeathDisclosureStatements[0];
    if (statement === undefined) throw new Error("DISCLOSURE_FIXTURE_REQUIRED");
    statement.locator["excerpt"] = "出租人持有期間，專有部分曾發生非自然死亡。";
    const client = new FakeClient(async () => ({
      response: providerResponse(provider),
      attempts: 1,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(client).analyze(inputs.contract),
    ).rejects.toMatchObject({ code: "ANALYSIS_LOCATOR_INVALID" });
  });

  it.each([
    [401, "ANALYSIS_PROVIDER_AUTH_FAILED"],
    [403, "ANALYSIS_PROVIDER_AUTH_FAILED"],
    [429, "ANALYSIS_PROVIDER_RATE_LIMITED"],
    [500, "ANALYSIS_PROVIDER_UNAVAILABLE"],
  ] as const)("maps status %s to %s and preserves retry attempts", async (status, code) => {
    const client = new FakeClient(async () => {
      throw { status, attempts: 2 };
    });
    await expect(
      new OpenAITerraAnalysisAdapter(client).analyze(inputs.listing),
    ).rejects.toMatchObject({
      code,
      providerAttempts: 2,
    });
  });

  it("marks missing usage unknown so budget reconciliation can fail closed", async () => {
    const client = new FakeClient(async () => ({
      response: providerResponse(outputs.listing, { usage: undefined }),
      attempts: 1,
    }));
    const result = await new OpenAITerraAnalysisAdapter(client).analyze(inputs.listing);
    expect(result.provenance.usage).toEqual({ known: false });
  });

  it("rejects invalid attempt metadata instead of undercounting", async () => {
    const client = new FakeClient(async () => ({
      response: providerResponse(outputs.listing),
      attempts: 0,
    }));
    await expect(
      new OpenAITerraAnalysisAdapter(client).analyze(inputs.listing),
    ).rejects.toBeInstanceOf(OpenAIAnalysisError);
  });
});
