import "server-only";

export type SubsidyPrecheckRequestEnvironment = Readonly<{
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
}>;

export function validateSubsidyPrecheckRequest(
  request: Request,
  environment: SubsidyPrecheckRequestEnvironment,
): { status: number; code: string } | null {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (host === null || !environment.allowedHosts.includes(host)) {
    return { status: 403, code: "SUBSIDY_PRECHECK_HOST_FORBIDDEN" };
  }
  if (origin === null || !environment.allowedOrigins.includes(origin)) {
    return { status: 403, code: "SUBSIDY_PRECHECK_ORIGIN_FORBIDDEN" };
  }
  if (contentType !== "application/json") {
    return { status: 415, code: "SUBSIDY_PRECHECK_CONTENT_TYPE_UNSUPPORTED" };
  }
  if (
    request.headers.has("forwarded") ||
    (forwardedHost !== null && forwardedHost !== host) ||
    (forwardedProto !== null && forwardedProto !== new URL(origin).protocol.slice(0, -1))
  ) {
    return { status: 403, code: "SUBSIDY_PRECHECK_FORWARDED_HEADER_FORBIDDEN" };
  }
  return null;
}
