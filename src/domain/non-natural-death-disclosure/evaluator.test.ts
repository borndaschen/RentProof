import { describe, expect, it } from "vitest";
import { evaluateNonNaturalDeathDisclosure } from "./evaluator";

function locator(id: string) {
  return {
    type: "pdf" as const,
    locatorId: id.padEnd(20, "0"),
    artifactId: "contract-status-confirmation-001",
    page: 4,
    start: 10,
    end: 24,
    excerpt: "虛構現況確認勾選內容",
  };
}

function statement(options: {
  id: string;
  period: "during_owner_holding" | "before_owner_holding_known";
  answer: "yes" | "no" | "unknown";
  sourceKind?:
    | "signed_status_confirmation"
    | "landlord_written_statement"
    | "rumor"
    | "address_search"
    | "news_report"
    | "model_inference";
  withLocator?: boolean;
}) {
  const sourceKind = options.sourceKind ?? "signed_status_confirmation";
  return {
    statementId: options.id,
    subjectScope: "exclusive_area" as const,
    period: options.period,
    answer: options.answer,
    eventTypes: options.answer === "yes" ? (["other_non_natural_death"] as const) : [],
    sourceKind,
    signedByProvider: sourceKind === "signed_status_confirmation",
    ...(options.withLocator === false ? {} : { locator: locator(`locator-${options.id}`) }),
  };
}

describe("evaluateNonNaturalDeathDisclosure", () => {
  it("keeps owner-holding and earlier-known periods separate", () => {
    const result = evaluateNonNaturalDeathDisclosure({
      statements: [
        statement({ id: "owner-period-no", period: "during_owner_holding", answer: "no" }),
        statement({ id: "earlier-known-yes", period: "before_owner_holding_known", answer: "yes" }),
      ],
    });
    expect(result.checks).toEqual([
      expect.objectContaining({
        period: "during_owner_holding",
        status: "supported",
        disclosedAnswer: "no",
      }),
      expect.objectContaining({
        period: "before_owner_holding_known",
        status: "supported",
        disclosedAnswer: "yes",
      }),
    ]);
    expect(result.actions).toContain("preserve_located_source_copy");
    expect(result.actions).not.toContain("obtain_signed_status_confirmation");
  });

  it("returns contradicted only for located explicit yes/no statements in the same period", () => {
    const result = evaluateNonNaturalDeathDisclosure({
      statements: [
        statement({ id: "explicit-yes", period: "during_owner_holding", answer: "yes" }),
        statement({
          id: "explicit-no",
          period: "during_owner_holding",
          answer: "no",
          sourceKind: "landlord_written_statement",
        }),
      ],
    });
    expect(result.checks[0]).toMatchObject({
      status: "contradicted",
      disclosedAnswer: "unknown",
      reasonCode: "EXPLICIT_DISCLOSURES_CONFLICT",
    });
    expect(result.checks[0].sourceLocators).toHaveLength(2);
  });

  it.each(["rumor", "address_search", "news_report", "model_inference"] as const)(
    "never turns %s into an affirmative fact",
    (sourceKind) => {
      const result = evaluateNonNaturalDeathDisclosure({
        statements: [
          statement({
            id: `excluded-${sourceKind}`,
            period: "during_owner_holding",
            answer: "yes",
            sourceKind,
          }),
        ],
      });
      expect(result.checks[0]).toMatchObject({
        status: "insufficient_evidence",
        disclosedAnswer: "unknown",
        reasonCode: "ONLY_UNVERIFIED_SOURCES_PROVIDED",
        sourceLocators: [],
      });
      expect(result.excludedUnverifiedSourceCount).toBe(1);
    },
  );

  it("requires a locator and explicit answer before supporting a disclosure", () => {
    const result = evaluateNonNaturalDeathDisclosure({
      statements: [
        statement({
          id: "missing-locator",
          period: "during_owner_holding",
          answer: "yes",
          withLocator: false,
        }),
        statement({ id: "unknown", period: "before_owner_holding_known", answer: "unknown" }),
      ],
    });
    expect(result.checks.every((check) => check.status === "insufficient_evidence")).toBe(true);
    expect(result.actions).toContain("obtain_signed_status_confirmation");
  });

  it("requests a signed form for located written statements and deduplicates locators", () => {
    const first = statement({
      id: "landlord-one",
      period: "during_owner_holding",
      answer: "no",
      sourceKind: "landlord_written_statement",
    });
    const second = {
      ...statement({
        id: "landlord-two",
        period: "during_owner_holding",
        answer: "no",
        sourceKind: "landlord_written_statement",
      }),
      locator: first.locator,
    };
    const result = evaluateNonNaturalDeathDisclosure({ statements: [first, second] });
    expect(result.checks[0].sourceLocators).toHaveLength(1);
    expect(result.actions).toEqual([
      "obtain_signed_status_confirmation",
      "ask_landlord_or_agent_in_writing",
      "preserve_located_source_copy",
    ]);
  });

  it("rejects malformed affirmative, scope, and signed-source inputs", () => {
    expect(() =>
      evaluateNonNaturalDeathDisclosure({
        statements: [
          {
            ...statement({ id: "bad-event", period: "during_owner_holding", answer: "yes" }),
            eventTypes: [],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      evaluateNonNaturalDeathDisclosure({
        statements: [
          {
            ...statement({ id: "bad-no-event", period: "during_owner_holding", answer: "no" }),
            eventTypes: ["suicide"],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      evaluateNonNaturalDeathDisclosure({
        statements: [
          {
            ...statement({
              id: "bad-written-sign",
              period: "during_owner_holding",
              answer: "no",
              sourceKind: "landlord_written_statement",
            }),
            signedByProvider: true,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      evaluateNonNaturalDeathDisclosure({
        statements: [
          {
            ...statement({ id: "bad-scope", period: "during_owner_holding", answer: "no" }),
            subjectScope: "entire_building",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      evaluateNonNaturalDeathDisclosure({
        statements: [
          {
            ...statement({ id: "bad-sign", period: "during_owner_holding", answer: "no" }),
            signedByProvider: false,
          },
        ],
      }),
    ).toThrow();
  });

  it("never emits verdict, probability, blame, price-impact, or blacklist fields", () => {
    const result = evaluateNonNaturalDeathDisclosure({ statements: [] });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /凶宅|verdict|probability|score|blame|liability|price.?impact|blacklist/iu,
    );
    expect(result.humanReviewRequired).toBe(true);
  });
});
