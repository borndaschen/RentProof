import { isIP } from "node:net";

export type NetworkBoundaryEnvironment = Readonly<{
  allowedHosts: readonly string[];
  RENTPROOF_PUBLIC_ORIGIN: string;
}>;

export type NetworkBoundaryResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason:
        | "HOST_INVALID"
        | "FORWARDED_HEADER_FORBIDDEN"
        | "FORWARDED_HOST_MISMATCH"
        | "FORWARDED_PROTO_MISMATCH"
        | "FORWARDED_PORT_MISMATCH"
        | "FORWARDED_FOR_INVALID";
    }>;

const HOST_PATTERN =
  /^(?:localhost|(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)|(?:\d{1,3}\.){3}\d{1,3}):[1-9]\d{0,4}$/iu;
const forbiddenForwardingHeaders = [
  "forwarded",
  "x-forwarded-server",
  "x-original-host",
  "x-host",
] as const;

export function validateGlobalNetworkBoundary(
  headers: Headers,
  environment: NetworkBoundaryEnvironment,
): NetworkBoundaryResult {
  const host = headers.get("host");
  if (
    host === null ||
    host !== host.trim() ||
    !HOST_PATTERN.test(host) ||
    host.includes(",") ||
    !environment.allowedHosts.includes(host)
  ) {
    return { ok: false, reason: "HOST_INVALID" };
  }

  if (forbiddenForwardingHeaders.some((name) => headers.has(name))) {
    return { ok: false, reason: "FORWARDED_HEADER_FORBIDDEN" };
  }

  const forwardedHost = headers.get("x-forwarded-host");
  if (
    forwardedHost !== null &&
    (forwardedHost !== forwardedHost.trim() ||
      forwardedHost.includes(",") ||
      forwardedHost !== host)
  ) {
    return { ok: false, reason: "FORWARDED_HOST_MISMATCH" };
  }

  let publicOrigin: URL;
  try {
    publicOrigin = new URL(environment.RENTPROOF_PUBLIC_ORIGIN);
  } catch {
    return { ok: false, reason: "HOST_INVALID" };
  }
  const expectedProtocol = publicOrigin.protocol.slice(0, -1);
  const forwardedProto = headers.get("x-forwarded-proto");
  if (
    forwardedProto !== null &&
    (forwardedProto.includes(",") || forwardedProto !== expectedProtocol)
  ) {
    return { ok: false, reason: "FORWARDED_PROTO_MISMATCH" };
  }

  const expectedPort = publicOrigin.port || (expectedProtocol === "https" ? "443" : "80");
  const forwardedPort = headers.get("x-forwarded-port");
  if (forwardedPort !== null && (forwardedPort.includes(",") || forwardedPort !== expectedPort)) {
    return { ok: false, reason: "FORWARDED_PORT_MISMATCH" };
  }

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor !== null) {
    const address =
      forwardedFor.startsWith("[") && forwardedFor.endsWith("]")
        ? forwardedFor.slice(1, -1)
        : forwardedFor;
    if (forwardedFor !== forwardedFor.trim() || forwardedFor.includes(",") || isIP(address) === 0) {
      return { ok: false, reason: "FORWARDED_FOR_INVALID" };
    }
  }

  return { ok: true };
}

export function isAuthProxyExcludedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/_next/image" ||
    pathname.startsWith("/_next/image?") ||
    pathname === "/favicon.ico"
  );
}

export function sanitizedDirectRequestHeaders(headers: Headers): Headers {
  const sanitized = new Headers(headers);
  for (const name of [
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-forwarded-server",
    "x-original-host",
    "x-host",
  ])
    sanitized.delete(name);
  return sanitized;
}
