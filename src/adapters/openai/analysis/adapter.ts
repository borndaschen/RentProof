import OpenAI from "openai";
import { z } from "zod";
import type { SourceLocator } from "@/domain/evidence-graph";
import {
  ContractAnalysisEnvelopeSchema,
  EvidenceAnalysisEnvelopeSchema,
  InteractionAnalysisEnvelopeSchema,
  ListingAnalysisEnvelopeSchema,
  TerraAnalysisInputSchema,
  TerraAnalysisOutputSchema,
  TerraAnalysisProviderOutputSchema,
} from "./contracts";
import type {
  AnalysisProviderReasonCode,
  AnalysisProvenance,
  AnalysisUsage,
  ProviderSourceLocator,
  TerraAnalysisInput,
  TerraAnalysisOutput,
  TerraAnalysisProviderOutput,
  TerraAnalysisStage,
  TerraAnalysisSuccess,
} from "./contracts";
import {
  buildTerraAnalysisRequest,
  TERRA_ANALYSIS_MODEL,
  TERRA_ANALYSIS_PROMPT_VERSIONS,
  TERRA_ANALYSIS_SCHEMA_VERSION,
} from "./request-builder";
import type { TerraAnalysisRequest } from "./request-builder";

export interface AnalysisResponsesClient {
  parse(request: TerraAnalysisRequest): Promise<Readonly<{ response: unknown; attempts: number }>>;
}

export class OpenAIAnalysisError extends Error {
  constructor(
    readonly code: AnalysisProviderReasonCode,
    readonly providerAttempts: number,
    readonly providerRequestId: string | null,
    readonly providerStatus: number | null = null,
    readonly providerErrorCode: string | null = null,
  ) {
    super(code);
    this.name = "OpenAIAnalysisError";
  }
}

const ProviderResponseSchema = z
  .object({
    id: z.string().min(1).max(128),
    status: z.enum(["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"]),
    model: z.string().min(1).max(128),
    service_tier: z.string().min(1).max(64).nullable().optional(),
    output_parsed: z.unknown().nullable(),
    output_text: z.string().optional(),
    output: z.array(z.unknown()),
    usage: z.unknown().optional(),
  })
  .passthrough();

const UsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }).passthrough(),
    output_tokens: z.number().int().nonnegative(),
    output_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative() })
      .passthrough(),
    total_tokens: z.number().int().nonnegative(),
  })
  .passthrough();

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

function providerErrorMetadata(
  error: unknown,
): Readonly<{ status: number | null; attempts: number; code: string | null }> {
  if (typeof error !== "object" || error === null) {
    return { status: null, attempts: 1, code: null };
  }
  const record = error as Record<string, unknown>;
  const status = typeof record["status"] === "number" ? record["status"] : null;
  const code = typeof record["code"] === "string" ? record["code"] : null;
  const attempts =
    typeof record["attempts"] === "number" &&
    Number.isSafeInteger(record["attempts"]) &&
    record["attempts"] >= 1
      ? record["attempts"]
      : 1;
  return { status, attempts, code };
}

function parseUsage(input: unknown): AnalysisUsage {
  const usage = UsageSchema.safeParse(input);
  if (!usage.success) return { known: false };
  return {
    known: true,
    inputTokens: usage.data.input_tokens,
    cachedInputTokens: usage.data.input_tokens_details.cached_tokens,
    outputTokens: usage.data.output_tokens,
    reasoningTokens: usage.data.output_tokens_details.reasoning_tokens,
    totalTokens: usage.data.total_tokens,
  };
}

function expectedOutputSchema(stage: TerraAnalysisStage) {
  switch (stage) {
    case "listing.extract":
      return ListingAnalysisEnvelopeSchema;
    case "evidence.extract":
      return EvidenceAnalysisEnvelopeSchema;
    case "contract.extract":
      return ContractAnalysisEnvelopeSchema;
    case "interaction.extract":
      return InteractionAnalysisEnvelopeSchema;
  }
}

function isLocatorIssue(error: z.ZodError): boolean {
  return error.issues.some(
    (issue) =>
      issue.path.some((segment) =>
        ["locator", "bbox", "page", "start", "end", "timestampMs", "frameNo"].includes(
          String(segment),
        ),
      ) || issue.message.includes("LOCATOR"),
  );
}

function rawParsedOutput(response: z.infer<typeof ProviderResponseSchema>): unknown {
  if (response.output_parsed !== null) return response.output_parsed;
  if (response.output_text === undefined) return null;
  try {
    return JSON.parse(response.output_text) as unknown;
  } catch {
    return null;
  }
}

function allowedArtifacts(input: TerraAnalysisInput): ReadonlySet<string> {
  switch (input.stage) {
    case "listing.extract":
      return new Set([
        input.artifact.kind === "text"
          ? input.artifact.artifactId
          : input.artifact.image.artifactId,
      ]);
    case "evidence.extract":
      return new Set(input.images.map((image) => image.artifactId));
    case "contract.extract":
    case "interaction.extract":
      return new Set([input.artifactId]);
  }
}

function entities(output: TerraAnalysisOutput) {
  switch (output.stage) {
    case "listing.extract":
      return output.claims;
    case "evidence.extract":
      return output.observations;
    case "contract.extract":
      return output.clauses;
    case "interaction.extract":
      return output.paymentRequestCues;
  }
}

function candidateLocators(
  output: Extract<TerraAnalysisProviderOutput, { stage: "interaction.extract" }>,
) {
  return Object.values(output.fraudCandidates).flatMap((candidate) =>
    candidate.status === "present" ? candidate.locators : [],
  );
}

function normalizeFraudCandidate(candidate: {
  status: "present" | "not_present" | "unknown";
  value?: string;
  locators?: readonly ProviderSourceLocator[];
}) {
  if (candidate.status !== "present" || candidate.value === undefined) {
    return { status: candidate.status };
  }
  return {
    status: "present" as const,
    value: candidate.value,
    locatorIds: (candidate.locators ?? []).map((locator) => locator.locatorId),
  };
}

function normalizeProviderLocator(locator: ProviderSourceLocator): SourceLocator {
  if (locator.type !== "image") return locator;
  return {
    ...locator,
    bbox: [locator.bbox.xMin, locator.bbox.yMin, locator.bbox.xMax, locator.bbox.yMax],
  };
}

function normalizeProviderOutput(output: TerraAnalysisProviderOutput): unknown {
  switch (output.stage) {
    case "listing.extract":
      return {
        ...output,
        claims: output.claims.map((claim) => ({
          ...claim,
          locator: normalizeProviderLocator(claim.locator),
        })),
      };
    case "evidence.extract":
      return {
        ...output,
        observations: output.observations.map((observation) => ({
          ...observation,
          locator: normalizeProviderLocator(observation.locator),
        })),
      };
    case "contract.extract":
      return {
        ...output,
        clauses: output.clauses.map((clause) => ({
          ...clause,
          locator: normalizeProviderLocator(clause.locator),
        })),
        nonNaturalDeathDisclosureStatements: output.nonNaturalDeathDisclosureStatements.map(
          (statement) => ({
            statementId: statement.statementId,
            subjectScope: statement.subjectScope,
            period: statement.period,
            answer: statement.answer,
            eventTypes: statement.eventTypes,
            sourceKind: statement.sourceKind,
            signedByProvider: statement.signedByProvider,
            locator: normalizeProviderLocator(statement.locator),
          }),
        ),
      };
    case "interaction.extract":
      return {
        ...output,
        paymentRequestCues: output.paymentRequestCues.map((cue) => ({
          ...cue,
          locator: normalizeProviderLocator(cue.locator),
        })),
        fraudCandidates: Object.fromEntries(
          Object.entries(output.fraudCandidates).map(([key, candidate]) => [
            key,
            normalizeFraudCandidate(candidate),
          ]),
        ),
      };
  }
}

function validateDisclosureProviderOwnership(
  input: TerraAnalysisInput,
  output: TerraAnalysisProviderOutput,
): boolean {
  if (input.stage !== "contract.extract" || output.stage !== "contract.extract") return true;
  return output.nonNaturalDeathDisclosureStatements.every((statement) => {
    const locator = statement.locator;
    if (locator.type !== "pdf") return false;
    return (
      statement.caseId === input.caseId &&
      statement.artifactId === input.artifactId &&
      locator.artifactId === input.artifactId &&
      exactPageExcerpt(
        input.pages.find((page) => page.page === locator.page)?.text,
        locator.start,
        locator.end,
        locator.excerpt,
      )
    );
  });
}

function validateListingTextLocators(
  input: TerraAnalysisInput,
  output: TerraAnalysisProviderOutput,
): boolean {
  if (input.stage !== "listing.extract" || input.artifact.kind !== "text") return true;
  if (output.stage !== "listing.extract") return false;
  const listingText = input.artifact.text;
  return output.claims.every(
    (claim) =>
      claim.locator.type === "text" &&
      exactPageExcerpt(listingText, claim.locator.start, claim.locator.end, claim.locator.excerpt),
  );
}

function validateEvidenceMediaLocators(
  input: TerraAnalysisInput,
  output: TerraAnalysisProviderOutput,
): boolean {
  if (input.stage !== "evidence.extract" || output.stage !== "evidence.extract") return true;
  return output.observations.every((observation) => {
    const source = input.images.find((image) => image.artifactId === observation.artifactId);
    if (source === undefined) return false;
    if (source.timestampMs === undefined || source.frameNo === undefined) {
      return observation.locator.type === "image";
    }
    return (
      observation.locator.type === "video" &&
      observation.locator.timestampMs === source.timestampMs &&
      observation.locator.frameNo === source.frameNo
    );
  });
}

function exactPageExcerpt(
  pageText: string | undefined,
  start: number,
  end: number,
  excerpt: string,
): boolean {
  if (pageText === undefined) return false;
  return [...pageText].slice(start, end).join("") === excerpt;
}

function outputLocators(output: TerraAnalysisOutput) {
  const base = entities(output).map((entity) => entity.locator);
  return output.stage === "contract.extract"
    ? [
        ...base,
        ...output.nonNaturalDeathDisclosureStatements.flatMap((statement) =>
          statement.locator === undefined ? [] : [statement.locator],
        ),
      ]
    : base;
}

function providerOutputLocators(output: TerraAnalysisProviderOutput) {
  if (output.stage !== "interaction.extract") return [];
  return candidateLocators(output);
}

function validateLocatorOwnership(input: TerraAnalysisInput, output: TerraAnalysisOutput): boolean {
  const allowed = allowedArtifacts(input);
  return entities(output).every(
    (entity) =>
      entity.caseId === input.caseId &&
      allowed.has(entity.artifactId) &&
      allowed.has(entity.locator.artifactId) &&
      entity.artifactId === entity.locator.artifactId,
  );
}

export class OpenAITerraAnalysisAdapter {
  constructor(private readonly client: AnalysisResponsesClient) {}

  async analyze(untrustedInput: unknown): Promise<TerraAnalysisSuccess> {
    const input = TerraAnalysisInputSchema.parse(untrustedInput);
    const request = buildTerraAnalysisRequest(input);
    let clientResult: Readonly<{ response: unknown; attempts: number }>;
    try {
      clientResult = await this.client.parse(request);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new OpenAIAnalysisError(
          isLocatorIssue(error) ? "ANALYSIS_LOCATOR_INVALID" : "ANALYSIS_PROVIDER_SCHEMA_INVALID",
          1,
          null,
        );
      }
      const metadata = providerErrorMetadata(error);
      const code =
        metadata.status === 401 || metadata.status === 403
          ? "ANALYSIS_PROVIDER_AUTH_FAILED"
          : metadata.status === 429
            ? "ANALYSIS_PROVIDER_RATE_LIMITED"
            : metadata.status === 400
              ? "ANALYSIS_PROVIDER_SCHEMA_INVALID"
              : "ANALYSIS_PROVIDER_UNAVAILABLE";
      throw new OpenAIAnalysisError(code, metadata.attempts, null, metadata.status, metadata.code);
    }

    if (!Number.isSafeInteger(clientResult.attempts) || clientResult.attempts < 1) {
      throw new OpenAIAnalysisError("ANALYSIS_PROVIDER_UNAVAILABLE", 1, null);
    }

    const responseResult = ProviderResponseSchema.safeParse(clientResult.response);
    if (!responseResult.success) {
      throw new OpenAIAnalysisError(
        "ANALYSIS_PROVIDER_SCHEMA_INVALID",
        clientResult.attempts,
        null,
      );
    }
    const response = responseResult.data;

    if (response.status === "incomplete") {
      throw new OpenAIAnalysisError(
        "ANALYSIS_PROVIDER_INCOMPLETE",
        clientResult.attempts,
        response.id,
      );
    }
    if (hasRefusal(response.output)) {
      throw new OpenAIAnalysisError(
        "ANALYSIS_PROVIDER_REFUSED",
        clientResult.attempts,
        response.id,
      );
    }
    if (response.status !== "completed") {
      throw new OpenAIAnalysisError(
        "ANALYSIS_PROVIDER_UNAVAILABLE",
        clientResult.attempts,
        response.id,
      );
    }

    const parsedOutput = expectedOutputSchema(input.stage).safeParse(rawParsedOutput(response));
    if (!parsedOutput.success) {
      throw new OpenAIAnalysisError(
        isLocatorIssue(parsedOutput.error)
          ? "ANALYSIS_LOCATOR_INVALID"
          : "ANALYSIS_PROVIDER_SCHEMA_INVALID",
        clientResult.attempts,
        response.id,
      );
    }
    const providerOutputResult = TerraAnalysisProviderOutputSchema.safeParse(parsedOutput.data);
    if (!providerOutputResult.success) {
      throw new OpenAIAnalysisError(
        isLocatorIssue(providerOutputResult.error)
          ? "ANALYSIS_LOCATOR_INVALID"
          : "ANALYSIS_PROVIDER_SCHEMA_INVALID",
        clientResult.attempts,
        response.id,
      );
    }
    const providerOutput = providerOutputResult.data;
    if (!validateDisclosureProviderOwnership(input, providerOutput)) {
      throw new OpenAIAnalysisError("ANALYSIS_LOCATOR_INVALID", clientResult.attempts, response.id);
    }
    if (!validateListingTextLocators(input, providerOutput)) {
      throw new OpenAIAnalysisError("ANALYSIS_LOCATOR_INVALID", clientResult.attempts, response.id);
    }
    if (!validateEvidenceMediaLocators(input, providerOutput)) {
      throw new OpenAIAnalysisError("ANALYSIS_LOCATOR_INVALID", clientResult.attempts, response.id);
    }
    if (
      input.stage === "interaction.extract" &&
      providerOutput.stage === "interaction.extract" &&
      providerOutputLocators(providerOutput).some(
        (locator) =>
          locator.type !== "text" ||
          locator.artifactId !== input.artifactId ||
          !exactPageExcerpt(input.text, locator.start, locator.end, locator.excerpt),
      )
    ) {
      throw new OpenAIAnalysisError("ANALYSIS_LOCATOR_INVALID", clientResult.attempts, response.id);
    }
    const normalizedOutput = TerraAnalysisOutputSchema.safeParse(
      normalizeProviderOutput(providerOutput),
    );
    if (!normalizedOutput.success) {
      throw new OpenAIAnalysisError(
        isLocatorIssue(normalizedOutput.error)
          ? "ANALYSIS_LOCATOR_INVALID"
          : "ANALYSIS_PROVIDER_SCHEMA_INVALID",
        clientResult.attempts,
        response.id,
      );
    }
    const output = normalizedOutput.data;
    if (!validateLocatorOwnership(input, output)) {
      throw new OpenAIAnalysisError("ANALYSIS_LOCATOR_INVALID", clientResult.attempts, response.id);
    }

    const provenance: AnalysisProvenance = {
      provider: "openai",
      endpoint: "responses.parse",
      stage: input.stage,
      requestedModel: TERRA_ANALYSIS_MODEL,
      resolvedModel: response.model,
      reasoningEffort: "medium",
      requestedServiceTier: "default",
      resolvedServiceTier: response.service_tier ?? null,
      promptVersion: TERRA_ANALYSIS_PROMPT_VERSIONS[input.stage],
      schemaVersion: TERRA_ANALYSIS_SCHEMA_VERSION,
      providerRequestId: response.id,
      providerAttempts: clientResult.attempts,
      usage: parseUsage(response.usage),
    };

    return {
      output,
      sourceLocators: [
        ...outputLocators(output),
        ...providerOutputLocators(providerOutput).map(normalizeProviderLocator),
      ],
      provenance,
    };
  }
}

export function createOpenAITerraAnalysisAdapter(apiKey: string): OpenAITerraAnalysisAdapter {
  if (!apiKey) throw new OpenAIAnalysisError("ANALYSIS_PROVIDER_AUTH_FAILED", 0, null);
  // Hidden SDK retries are disabled so every provider attempt can be reserved and counted.
  const openai = new OpenAI({ apiKey, maxRetries: 0 });
  return new OpenAITerraAnalysisAdapter({
    async parse(request) {
      return { response: await openai.responses.parse(request), attempts: 1 };
    },
  });
}
