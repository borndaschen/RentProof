export type ReportCompositionErrorCode =
  "REPORT_FORBIDDEN_LANGUAGE" | "REPORT_LOCATOR_COVERAGE_INVALID";

export class ReportCompositionError extends Error {
  readonly code: ReportCompositionErrorCode;

  constructor(code: ReportCompositionErrorCode) {
    super(code);
    this.name = "ReportCompositionError";
    this.code = code;
  }
}

const FORBIDDEN_REPORT_LANGUAGE =
  /違法|合法|確定詐騙|就是詐騙|詐騙機率|安全分數|安全無虞|房東有責|責任歸屬|是凶宅|不是凶宅|凶宅機率|凶宅分數|凶宅黑名單/u;

function containsForbiddenLanguage(value: unknown): boolean {
  if (typeof value === "string") return FORBIDDEN_REPORT_LANGUAGE.test(value);
  if (Array.isArray(value)) return value.some(containsForbiddenLanguage);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(containsForbiddenLanguage);
  }
  return false;
}

export function assertNeutralReportLanguage(value: unknown): void {
  if (containsForbiddenLanguage(value)) {
    throw new ReportCompositionError("REPORT_FORBIDDEN_LANGUAGE");
  }
}
