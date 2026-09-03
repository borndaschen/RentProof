import { z } from "zod";
import type { OfficialRuleId } from "./model";

export const OfficialRuleProfileSchema = z.enum(["p0", "p1"]);
export type OfficialRuleProfile = z.infer<typeof OfficialRuleProfileSchema>;

export const P0_OFFICIAL_RULE_IDS = [
  "RP-003",
  "RP-004",
  "RP-006",
  "RP-008",
  "RP-009",
  "RP-010",
] as const satisfies readonly OfficialRuleId[];

export const P1_OFFICIAL_RULE_IDS = [
  "RP-001",
  "RP-002",
  "RP-003",
  "RP-004",
  "RP-005",
  "RP-006",
  "RP-007",
  "RP-008",
  "RP-009",
  "RP-010",
] as const satisfies readonly OfficialRuleId[];

export const OFFICIAL_RULE_TITLES = {
  "RP-001": "契約審閱期",
  "RP-002": "廣告承諾不得整體排除",
  "RP-003": "租賃範圍與附屬設備",
  "RP-004": "租金與完整費用",
  "RP-005": "押金上限與返還",
  "RP-006": "按度電費",
  "RP-007": "非按度計費與公共用電",
  "RP-008": "電費資訊提供義務",
  "RP-009": "修繕責任與聯絡方式",
  "RP-010": "不得限制申請租金補貼",
} as const satisfies Record<OfficialRuleId, string>;

export function officialRuleIdsForProfile(profile: OfficialRuleProfile): readonly OfficialRuleId[] {
  return profile === "p1" ? P1_OFFICIAL_RULE_IDS : P0_OFFICIAL_RULE_IDS;
}

export function isCompleteOfficialRuleProfile(ruleIds: readonly string[]): boolean {
  const sorted = [...new Set(ruleIds)].sort();
  return [P0_OFFICIAL_RULE_IDS, P1_OFFICIAL_RULE_IDS].some(
    (profile) =>
      ruleIds.length === profile.length &&
      JSON.stringify(sorted) === JSON.stringify([...profile].sort()),
  );
}
