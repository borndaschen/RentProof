import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  SubsidyYearUpdateError,
  createSubsidyYearDraft,
} from "../src/domain/subsidy/year-update.ts";

const ALLOWED_FLAGS = new Set(["--roc-year", "--gregorian-year", "--output-dir"]);

function parseArguments(argv: readonly string[]): ReadonlyMap<string, string> {
  if (argv.length % 2 !== 0) throw new Error("SUBSIDY_YEAR_ARGUMENTS_INVALID");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !ALLOWED_FLAGS.has(flag) ||
      values.has(flag) ||
      value.length === 0 ||
      value.includes("\0") ||
      value.startsWith("--")
    ) {
      throw new Error("SUBSIDY_YEAR_ARGUMENTS_INVALID");
    }
    values.set(flag, value);
  }
  return values;
}

function parseYear(value: string | undefined, code: string): number {
  if (value === undefined || !/^[0-9]{3,4}$/u.test(value)) throw new Error(code);
  return Number(value);
}

try {
  const argumentsByFlag = parseArguments(process.argv.slice(2));
  const rocYear = parseYear(argumentsByFlag.get("--roc-year"), "SUBSIDY_YEAR_ROC_INVALID");
  const gregorianYear = parseYear(
    argumentsByFlag.get("--gregorian-year"),
    "SUBSIDY_YEAR_GREGORIAN_INVALID",
  );
  const outputRoot = resolve(argumentsByFlag.get("--output-dir") ?? "rules/annual-drafts");
  const draft = createSubsidyYearDraft({ rocYear, gregorianYear });
  mkdirSync(outputRoot, { recursive: true });
  const canonicalOutputRoot = realpathSync.native(outputRoot);
  const outputPath = resolve(
    canonicalOutputRoot,
    `rent-subsidy-precheck-${String(rocYear)}.draft.json`,
  );
  const pathFromRoot = relative(canonicalOutputRoot, outputPath);
  if (pathFromRoot.length === 0 || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("SUBSIDY_YEAR_OUTPUT_OUTSIDE_ROOT");
  }
  writeFileSync(outputPath, `${JSON.stringify(draft, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(`SUBSIDY_YEAR_DRAFT_CREATED ${outputPath}\n`);
} catch (error) {
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code =
    error instanceof SubsidyYearUpdateError
      ? error.code
      : errorCode === "EEXIST"
        ? "SUBSIDY_YEAR_DRAFT_EXISTS"
        : error instanceof Error && error.message.startsWith("SUBSIDY_YEAR_")
          ? error.message
          : "SUBSIDY_YEAR_SCAFFOLD_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
