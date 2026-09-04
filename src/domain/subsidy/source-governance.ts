export const SUBSIDY_SOURCE_VERIFIED_AT = "2026-09-04" as const;
export const SUBSIDY_SOURCE_MAX_AGE_DAYS = 31 as const;

export const SUBSIDY_SOURCE_SNAPSHOT_HASHES = {
  MOI_115_CONDITIONS: "41b83fe75141f1d2fddd61fa9742efcede93e28ab7b158493366d36c79c5b570",
  MOI_115_FAQ: "45a38bc895a5cc082b108065ce6b67563a83589a5b737e285ffc50f2fc1c2f78",
} as const;

export type SubsidySourceGovernanceCode =
  | "SUBSIDY_SOURCE_DATE_INVALID"
  | "SUBSIDY_SOURCE_SEMANTIC_BOUNDARY_INVALID"
  | "SUBSIDY_SOURCE_STALE"
  | "SUBSIDY_SOURCE_VERIFICATION_IN_FUTURE";

export type SubsidySourceSemanticRegion = "article" | "homepage" | "whole_document";

export class SubsidySourceGovernanceError extends Error {
  readonly code: SubsidySourceGovernanceCode;

  constructor(code: SubsidySourceGovernanceCode) {
    super(code);
    this.name = "SubsidySourceGovernanceError";
    this.code = code;
  }
}

export function assertCurrentSubsidySources(now: Date): void {
  const nowMs = now.getTime();
  const verifiedMs = Date.parse(`${SUBSIDY_SOURCE_VERIFIED_AT}T00:00:00+08:00`);
  if (!Number.isFinite(nowMs) || !Number.isFinite(verifiedMs)) {
    throw new SubsidySourceGovernanceError("SUBSIDY_SOURCE_DATE_INVALID");
  }
  const ageDays = (nowMs - verifiedMs) / 86_400_000;
  if (ageDays < 0) {
    throw new SubsidySourceGovernanceError("SUBSIDY_SOURCE_VERIFICATION_IN_FUTURE");
  }
  if (ageDays > SUBSIDY_SOURCE_MAX_AGE_DAYS) {
    throw new SubsidySourceGovernanceError("SUBSIDY_SOURCE_STALE");
  }
}

export function normalizeSubsidySourceHtml(
  text: string,
  region: SubsidySourceSemanticRegion,
): string {
  let governedText = text;
  if (region !== "whole_document") {
    const markers: readonly [string, string] =
      region === "article"
        ? ['<div class="art-head">', '<div class="back-btn">']
        : ['<div class="homepage-body">', "</main>"];
    const [startMarker, endMarker] = markers;
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start + startMarker.length);
    if (
      start < 0 ||
      end < 0 ||
      text.indexOf(startMarker, start + startMarker.length) >= 0 ||
      text.indexOf(endMarker, end + endMarker.length) >= 0
    ) {
      throw new SubsidySourceGovernanceError("SUBSIDY_SOURCE_SEMANTIC_BOUNDARY_INVALID");
    }
    governedText = text.slice(start, end);
  }
  return governedText
    .replace(/<input name="__RequestVerificationToken"[^>]*>/gu, "")
    .replace(/<script\b([^>]*?)\snonce="[^"]*"([^>]*)>/gu, "<script$1$2>")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
}
