import type { SourceLocator } from "../evidence-graph";
import {
  NonNaturalDeathDisclosureInputSchema,
  NonNaturalDeathDisclosureResultSchema,
  type NonNaturalDeathDisclosureResult,
} from "./schema";

const periods = ["during_owner_holding", "before_owner_holding_known"] as const;
const excludedSources = new Set(["rumor", "address_search", "news_report", "model_inference"]);

export function evaluateNonNaturalDeathDisclosure(input: unknown): NonNaturalDeathDisclosureResult {
  const parsed = NonNaturalDeathDisclosureInputSchema.parse(input);
  const excludedUnverifiedSourceCount = parsed.statements.filter((statement) =>
    excludedSources.has(statement.sourceKind),
  ).length;
  const eligible = parsed.statements.filter(
    (
      statement,
    ): statement is typeof statement & {
      locator: SourceLocator;
      answer: "yes" | "no";
    } =>
      !excludedSources.has(statement.sourceKind) &&
      statement.locator !== undefined &&
      statement.answer !== "unknown",
  );
  const checks = periods.map((period) => {
    const matching = eligible.filter((statement) => statement.period === period);
    const answers = new Set(matching.map((statement) => statement.answer));
    const sourceLocators = uniqueLocators(matching.map((statement) => statement.locator));
    if (answers.has("yes") && answers.has("no")) {
      return {
        period,
        status: "contradicted" as const,
        disclosedAnswer: "unknown" as const,
        reasonCode: "EXPLICIT_DISCLOSURES_CONFLICT" as const,
        sourceLocators,
      };
    }
    const answer = matching[0]?.answer;
    if (answer === "yes" || answer === "no") {
      return {
        period,
        status: "supported" as const,
        disclosedAnswer: answer,
        reasonCode: "EXPLICIT_DISCLOSURE_SUPPORTED" as const,
        sourceLocators,
      };
    }
    const hasExcludedForPeriod = parsed.statements.some(
      (statement) => statement.period === period && excludedSources.has(statement.sourceKind),
    );
    return {
      period,
      status: "insufficient_evidence" as const,
      disclosedAnswer: "unknown" as const,
      reasonCode: hasExcludedForPeriod
        ? ("ONLY_UNVERIFIED_SOURCES_PROVIDED" as const)
        : ("EXPLICIT_DISCLOSURE_MISSING" as const),
      sourceLocators: [],
    };
  }) as [
    NonNaturalDeathDisclosureResult["checks"][0],
    NonNaturalDeathDisclosureResult["checks"][1],
  ];
  const hasSignedConfirmation = parsed.statements.some(
    (statement) =>
      statement.sourceKind === "signed_status_confirmation" &&
      statement.locator !== undefined &&
      statement.answer !== "unknown",
  );
  const actions = [
    ...(!hasSignedConfirmation ? (["obtain_signed_status_confirmation"] as const) : []),
    "ask_landlord_or_agent_in_writing" as const,
    ...((eligible.length > 0
      ? ["preserve_located_source_copy"]
      : []) as Array<"preserve_located_source_copy">),
  ];
  return NonNaturalDeathDisclosureResultSchema.parse({
    schema: "rentproof.non-natural-death-disclosure.v1",
    subjectScope: "exclusive_area",
    checks,
    actions,
    excludedUnverifiedSourceCount,
    humanReviewRequired: true,
  });
}

function uniqueLocators(locators: SourceLocator[]): SourceLocator[] {
  const seen = new Set<string>();
  return locators.filter((locator) => {
    if (seen.has(locator.locatorId)) return false;
    seen.add(locator.locatorId);
    return true;
  });
}
