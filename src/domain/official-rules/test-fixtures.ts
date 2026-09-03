import type { CaseRuleLocator, OfficialSourceReference } from "./model";

export const officialSource: OfficialSourceReference = {
  sourceId: "ELECTRICITY_2024",
  title: "住宅租賃定型化契約應記載及不得記載事項",
  publisher: "行政院",
  url: "https://www.ey.gov.tw/example",
  snapshotSha256: "a".repeat(64),
  ruleLocator: "應記載事項第11點",
  rulesetVersion: "1.0.0-draft",
};

export const caseLocators: CaseRuleLocator[] = [
  { kind: "case_field", field: "case.general_residential_scope" },
  {
    kind: "contract_text",
    artifactId: "contract-1",
    page: 3,
    excerpt: "本契約之相關約定文字",
  },
];

export const baseContext = {
  generalResidentialScope: true,
  intendedSignedAt: "2026-09-10",
  officialSource,
  caseLocators,
} as const;

export function sourceWithId(sourceId: string): OfficialSourceReference {
  return { ...officialSource, sourceId };
}
