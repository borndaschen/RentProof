import type { CaseHistoryDetail, CaseHistorySummary } from "@/application/history";

const caseStatuses = ["draft", "analyzing", "needs_attention", "ready"] as const;
const opaqueIdPattern = /^[A-Za-z0-9_-]{20,128}$/u;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export function parseHistoryResponse(value: unknown): readonly CaseHistorySummary[] | null {
  if (!hasExactKeys(value, ["schemaVersion", "cases"])) return null;
  if (value["schemaVersion"] !== "rentproof.case-history.v1" || !Array.isArray(value["cases"])) {
    return null;
  }
  const cases: CaseHistorySummary[] = [];
  for (const item of value["cases"]) {
    const parsed = parseSummary(item);
    if (parsed === null) return null;
    cases.push(parsed);
  }
  return cases;
}

export function parseHistoryDetailResponse(value: unknown): CaseHistoryDetail | null {
  if (!hasExactKeys(value, ["schemaVersion", "case"])) return null;
  if (value["schemaVersion"] !== "rentproof.case-history-detail.v1") return null;
  const item = value["case"];
  if (
    !hasExactKeys(item, [
      "caseId",
      "displayName",
      "status",
      "updatedAt",
      "revision",
      "sourceMode",
      "createdAt",
    ])
  ) {
    return null;
  }
  const summary = parseSummaryFields(item);
  const revision = item["revision"];
  const sourceMode = item["sourceMode"];
  const createdAt = item["createdAt"];
  if (
    summary === null ||
    !Number.isSafeInteger(revision) ||
    Number(revision) < 0 ||
    (sourceMode !== "fixture" && sourceMode !== "live") ||
    !isIsoTimestamp(createdAt)
  ) {
    return null;
  }
  return { ...summary, revision: Number(revision), sourceMode, createdAt };
}

function parseSummary(value: unknown): CaseHistorySummary | null {
  return hasExactKeys(value, ["caseId", "displayName", "status", "updatedAt"])
    ? parseSummaryFields(value)
    : null;
}

function parseSummaryFields(value: Record<string, unknown>): CaseHistorySummary | null {
  const caseId = value["caseId"];
  const displayName = value["displayName"];
  const status = value["status"];
  const updatedAt = value["updatedAt"];
  if (
    typeof caseId !== "string" ||
    !opaqueIdPattern.test(caseId) ||
    typeof displayName !== "string" ||
    displayName.length < 1 ||
    displayName.length > 120 ||
    !isCaseStatus(status) ||
    !isIsoTimestamp(updatedAt)
  ) {
    return null;
  }
  return { caseId, displayName, status, updatedAt };
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => keys.includes(key));
}

function isCaseStatus(value: unknown): value is CaseHistorySummary["status"] {
  return typeof value === "string" && caseStatuses.some((status) => status === value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isoTimestampPattern.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
