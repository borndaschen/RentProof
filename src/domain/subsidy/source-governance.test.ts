import { describe, expect, it } from "vitest";
import {
  SUBSIDY_SOURCE_SNAPSHOT_HASHES,
  SubsidySourceGovernanceError,
  assertCurrentSubsidySources,
  normalizeSubsidySourceHtml,
} from "./source-governance";

describe("subsidy source governance", () => {
  it.each(["2026-09-04T00:00:00+08:00", "2026-10-05T00:00:00+08:00"])(
    "accepts a source age inside the 31-day window at %s",
    (now) => expect(() => assertCurrentSubsidySources(new Date(now))).not.toThrow(),
  );

  it.each([
    ["2026-09-03T23:59:59+08:00", "SUBSIDY_SOURCE_VERIFICATION_IN_FUTURE"],
    ["2026-10-05T00:00:01+08:00", "SUBSIDY_SOURCE_STALE"],
  ] as const)("fails closed at %s", (now, code) => {
    expect(() => assertCurrentSubsidySources(new Date(now))).toThrowError(
      expect.objectContaining<Partial<SubsidySourceGovernanceError>>({ code }),
    );
  });

  it("rejects an invalid clock and exposes only fixed lowercase SHA-256 values", () => {
    expect(() => assertCurrentSubsidySources(new Date(Number.NaN))).toThrowError(
      expect.objectContaining<Partial<SubsidySourceGovernanceError>>({
        code: "SUBSIDY_SOURCE_DATE_INVALID",
      }),
    );
    expect(Object.values(SUBSIDY_SOURCE_SNAPSHOT_HASHES)).toHaveLength(2);
    for (const hash of Object.values(SUBSIDY_SOURCE_SNAPSHOT_HASHES)) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("normalizes only allowlisted dynamic HTML while preserving governed content", () => {
    const decomposed = "e\u0301";
    expect(
      normalizeSubsidySourceHtml(
        `<div nonce="retain"> ${decomposed} </div><script src="/a.js" nonce="random"></script><input name="__RequestVerificationToken" type="hidden" value="random">`,
        "whole_document",
      ),
    ).toBe('<div nonce="retain"> é </div><script src="/a.js"></script>');
  });

  it.each([
    [
      "article",
      'outside<div class="art-head"> governed </div><div class="back-btn">outside',
      '<div class="art-head"> governed </div>',
    ],
    [
      "homepage",
      'outside<div class="homepage-body"> governed </div></main>outside',
      '<div class="homepage-body"> governed </div>',
    ],
  ] as const)("extracts one explicit %s semantic region", (region, html, expected) => {
    expect(normalizeSubsidySourceHtml(html, region)).toBe(expected);
  });

  it.each([
    ["article", "<html>no article</html>"],
    ["homepage", '<div class="homepage-body">one</div><div class="homepage-body">two</div></main>'],
  ] as const)("fails closed for an invalid %s semantic boundary", (region, html) => {
    expect(() => normalizeSubsidySourceHtml(html, region)).toThrowError(
      expect.objectContaining<Partial<SubsidySourceGovernanceError>>({
        code: "SUBSIDY_SOURCE_SEMANTIC_BOUNDARY_INVALID",
      }),
    );
  });
});
