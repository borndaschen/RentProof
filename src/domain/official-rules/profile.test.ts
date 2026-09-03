import { describe, expect, it } from "vitest";
import {
  OFFICIAL_RULE_TITLES,
  P0_OFFICIAL_RULE_IDS,
  P1_OFFICIAL_RULE_IDS,
  isCompleteOfficialRuleProfile,
  officialRuleIdsForProfile,
} from "./profile";

describe("official-rule profiles", () => {
  it("keeps the sealed Golden P0 set stable and enables all ten only for explicit P1", () => {
    expect(officialRuleIdsForProfile("p0")).toEqual(P0_OFFICIAL_RULE_IDS);
    expect(officialRuleIdsForProfile("p1")).toEqual(P1_OFFICIAL_RULE_IDS);
    expect(P0_OFFICIAL_RULE_IDS).toHaveLength(6);
    expect(P1_OFFICIAL_RULE_IDS).toHaveLength(10);
    expect(new Set(P1_OFFICIAL_RULE_IDS)).toEqual(new Set(Object.keys(OFFICIAL_RULE_TITLES)));
  });

  it("rejects incomplete, duplicate, and mixed response sets", () => {
    expect(isCompleteOfficialRuleProfile(P0_OFFICIAL_RULE_IDS)).toBe(true);
    expect(isCompleteOfficialRuleProfile(P1_OFFICIAL_RULE_IDS)).toBe(true);
    expect(isCompleteOfficialRuleProfile(P1_OFFICIAL_RULE_IDS.slice(1))).toBe(false);
    expect(isCompleteOfficialRuleProfile([...P0_OFFICIAL_RULE_IDS, "RP-003"])).toBe(false);
  });
});
