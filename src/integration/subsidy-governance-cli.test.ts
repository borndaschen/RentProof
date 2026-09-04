import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SubsidyYearDraftSchema } from "@/domain/subsidy";

describe("subsidy governance CLIs", () => {
  it("passes the offline source check against the controlled local snapshots", () => {
    const result = spawnSync(process.execPath, ["scripts/check-subsidy-sources.mts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("SUBSIDY_SOURCES_OK mode=offline");
  });

  it.each([["--unknown"], ["--live", "--live"]])(
    "rejects unsupported source-check arguments %# without fetching",
    (...argumentsList) => {
      const result = spawnSync(
        process.execPath,
        ["scripts/check-subsidy-sources.mts", ...argumentsList],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 20_000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("SUBSIDY_SOURCE_ARGUMENTS_INVALID\n");
    },
  );

  it("creates one empty future-year draft and refuses to overwrite it", () => {
    const output = mkdtempSync(join(tmpdir(), "rentproof-subsidy-year-"));
    try {
      const args = [
        "scripts/scaffold-subsidy-year.mts",
        "--roc-year",
        "116",
        "--gregorian-year",
        "2027",
        "--output-dir",
        output,
      ];
      const first = spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(first.status, first.stderr).toBe(0);
      const created = SubsidyYearDraftSchema.parse(
        JSON.parse(
          readFileSync(join(output, "rent-subsidy-precheck-116.draft.json"), "utf8"),
        ) as unknown,
      );
      expect(created).toMatchObject({
        productionReady: false,
        copiedFromPriorYear: false,
        thresholds: null,
        rules: [],
      });

      const second = spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(second.status).toBe(1);
      expect(second.stderr).toBe("SUBSIDY_YEAR_DRAFT_EXISTS\n");
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  it.each([
    [["--roc-year", "116", "--gregorian-year"], "SUBSIDY_YEAR_ARGUMENTS_INVALID"],
    [
      ["--roc-year", "116", "--roc-year", "117", "--gregorian-year", "2027"],
      "SUBSIDY_YEAR_ARGUMENTS_INVALID",
    ],
    [["--roc-year", "../116", "--gregorian-year", "2027"], "SUBSIDY_YEAR_ROC_INVALID"],
    [["--roc-year", "116", "--gregorian-year", "2028"], "SUBSIDY_YEAR_MAPPING_INVALID"],
  ] as const)("rejects malformed scaffold arguments %#", (argumentsList, code) => {
    const result = spawnSync(
      process.execPath,
      ["scripts/scaffold-subsidy-year.mts", ...argumentsList],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`${code}\n`);
  });
});
