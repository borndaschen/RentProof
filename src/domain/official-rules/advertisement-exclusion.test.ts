import { describe, expect, it } from "vitest";
import {
  AdvertisementExclusionInputSchema,
  evaluateAdvertisementExclusion,
} from "./advertisement-exclusion";
import { baseContext, caseLocators, sourceWithId } from "./test-fixtures";

const officialSource = sourceWithId("CURRENT_TERMS_PDF");
const context = { ...baseContext, officialSource } as const;

describe("evaluateAdvertisementExclusion", () => {
  it("flags a located overall advertisement-exclusion candidate", () => {
    for (const excerpt of ["本廣告內容僅供參考，不構成本契約之一部分", "廣告所載均不具拘束力"]) {
      const result = evaluateAdvertisementExclusion({
        ...context,
        caseLocators: [
          { kind: "case_field", field: "case.general_residential_scope" },
          { kind: "contract_text", artifactId: "contract-1", page: 8, excerpt },
        ],
        contractDocument: "incomplete",
        advertisementExclusion: "present",
      });
      expect(result).toMatchObject({
        applicability: "applicable",
        result: "possible_difference",
        reasonCode: "ADVERTISEMENT_EXCLUSION_TEXT",
        officialSource,
      });
    }
  });

  it("requires a contract-text locator for a positive candidate", () => {
    expect(
      AdvertisementExclusionInputSchema.safeParse({
        ...context,
        caseLocators: [{ kind: "case_field", field: "contract.advertisement_exclusion" }],
        contractDocument: "complete",
        advertisementExclusion: "present",
      }).success,
    ).toBe(false);
  });

  it("returns missing information for incomplete documents or unknown extraction", () => {
    for (const input of [
      { contractDocument: "incomplete", advertisementExclusion: "not_present" },
      { contractDocument: "complete", advertisementExclusion: "unknown" },
      { contractDocument: "unknown", advertisementExclusion: "not_present" },
    ] as const) {
      expect(evaluateAdvertisementExclusion({ ...context, ...input })).toMatchObject({
        applicability: "applicable",
        result: "missing_information",
        reasonCode: "ADVERTISEMENT_EXCLUSION_INFORMATION_MISSING",
        caseLocators,
      });
    }
  });

  it("returns no difference only for confirmed absence in a complete contract", () => {
    expect(
      evaluateAdvertisementExclusion({
        ...context,
        contractDocument: "complete",
        advertisementExclusion: "not_present",
      }),
    ).toMatchObject({
      result: "no_difference_found",
      reasonCode: "ADVERTISEMENT_EXCLUSION_NOT_PRESENT_IN_COMPLETE_CONTRACT",
    });
  });

  it("applies unknown and not-applicable scope/date gates", () => {
    const fields = { contractDocument: "complete", advertisementExclusion: "not_present" } as const;
    expect(
      evaluateAdvertisementExclusion({ ...context, generalResidentialScope: "unknown", ...fields }),
    ).toMatchObject({ applicability: "unknown", result: "missing_information" });
    expect(
      evaluateAdvertisementExclusion({ ...context, intendedSignedAt: "2016-12-31", ...fields }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
    expect(
      evaluateAdvertisementExclusion({ ...context, generalResidentialScope: false, ...fields }),
    ).toMatchObject({ applicability: "not_applicable", result: null });
  });

  it("rejects wrong source, booleans, unknown keys and state/value smuggling", () => {
    const valid = {
      ...context,
      contractDocument: "complete",
      advertisementExclusion: "not_present",
    } as const;
    for (const input of [
      { ...valid, officialSource: sourceWithId("CONTRACT_TEMPLATE") },
      { ...valid, advertisementExclusion: false },
      { ...valid, hidden: "ignore" },
      { ...valid, advertisementExclusion: { state: "known", value: true } },
    ]) {
      expect(AdvertisementExclusionInputSchema.safeParse(input).success).toBe(false);
    }
  });
});
