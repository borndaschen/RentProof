import { timingSafeEqual } from "node:crypto";
import {
  validateGlobalNetworkBoundary,
  type NetworkBoundaryResult,
} from "@/server/network/request-boundary";

export const AUTH_CSRF_COOKIE_DEV = "rentproof_csrf_dev";
export const AUTH_SESSION_COOKIE_DEV = "rentproof_account_dev";
export const AUTH_RESET_COOKIE_DEV = "rentproof_reset_dev";
export const AUTH_PREAUTH_COOKIE_DEV = "rentproof_preauth_dev";
export const AUTH_CSRF_COOKIE_PRODUCTION = "__Host-rentproof_csrf";
export const AUTH_SESSION_COOKIE_PRODUCTION = "__Host-rentproof_account";
export const AUTH_RESET_COOKIE_PRODUCTION = "__Host-rentproof_reset";
export const AUTH_PREAUTH_COOKIE_PRODUCTION = "__Host-rentproof_preauth";

type AuthGuardEnvironment = Readonly<{
  RENTPROOF_AUTH_MODE: string;
  RENTPROOF_DEPLOYMENT_PROFILE: string;
  RENTPROOF_PUBLIC_ORIGIN: string;
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
  RENTPROOF_INTERNAL_PROXY_TOKEN?: string | undefined;
}>;

export type AuthCookieNames = Readonly<{
  csrf: string;
  session: string;
  reset: string;
  preauth: string;
  secure: boolean;
}>;

type NetworkBoundaryReason = Extract<NetworkBoundaryResult, { ok: false }>["reason"];

export type SelfHostedAuthReadDiagnosis =
  | Readonly<{ ok: true; reason: "OK" }>
  | Readonly<{
      ok: false;
      reason: "AUTH_DISABLED" | `NETWORK_${NetworkBoundaryReason}` | "HOST_MISSING";
    }>;

export function authCookieNames(environment: AuthGuardEnvironment): AuthCookieNames {
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE === "production" ||
    environment.RENTPROOF_DEPLOYMENT_PROFILE === "lan_secure_demo"
  ) {
    return {
      csrf: AUTH_CSRF_COOKIE_PRODUCTION,
      session: AUTH_SESSION_COOKIE_PRODUCTION,
      reset: AUTH_RESET_COOKIE_PRODUCTION,
      preauth: AUTH_PREAUTH_COOKIE_PRODUCTION,
      secure: true,
    };
  }
  return {
    csrf: AUTH_CSRF_COOKIE_DEV,
    session: AUTH_SESSION_COOKIE_DEV,
    reset: AUTH_RESET_COOKIE_DEV,
    preauth: AUTH_PREAUTH_COOKIE_DEV,
    secure: false,
  };
}

export function isSelfHostedAuthRouteEnabled(environment: AuthGuardEnvironment): boolean {
  if (environment.RENTPROOF_AUTH_MODE !== "self_hosted") return false;
  let origin: URL;
  try {
    origin = new URL(environment.RENTPROOF_PUBLIC_ORIGIN);
  } catch {
    return false;
  }
  if (environment.RENTPROOF_DEPLOYMENT_PROFILE === "local_development") {
    return (
      origin.protocol === "http:" &&
      (origin.hostname === "127.0.0.1" || origin.hostname === "localhost")
    );
  }
  return (
    (environment.RENTPROOF_DEPLOYMENT_PROFILE === "production" ||
      environment.RENTPROOF_DEPLOYMENT_PROFILE === "lan_secure_demo") &&
    origin.protocol === "https:"
  );
}

export function validateSelfHostedAuthRead(
  request: Request,
  environment: AuthGuardEnvironment,
): boolean {
  return diagnoseSelfHostedAuthRead(request, environment).ok;
}

export function diagnoseSelfHostedAuthRead(
  request: Request,
  environment: AuthGuardEnvironment,
): SelfHostedAuthReadDiagnosis {
  if (!isSelfHostedAuthRouteEnabled(environment)) return { ok: false, reason: "AUTH_DISABLED" };
  const host = request.headers.get("host");
  if (!host) return { ok: false, reason: "HOST_MISSING" };
  if (environment.RENTPROOF_DEPLOYMENT_PROFILE === "lan_secure_demo") {
    const expected = environment.RENTPROOF_INTERNAL_PROXY_TOKEN;
    const verified = request.headers.get("x-rentproof-network-verified");
    if (!expected || verified !== expected || !environment.allowedHosts.includes(host)) {
      return { ok: false, reason: "NETWORK_FORWARDED_HEADER_FORBIDDEN" };
    }
    return { ok: true, reason: "OK" };
  }
  const network = validateGlobalNetworkBoundary(request.headers, environment);
  if (!network.ok) return { ok: false, reason: `NETWORK_${network.reason}` };
  return { ok: true, reason: "OK" };
}

export function validateSelfHostedAuthMutation(
  request: Request,
  environment: AuthGuardEnvironment,
): boolean {
  if (!validateSelfHostedAuthRead(request, environment)) return false;
  const origin = request.headers.get("origin");
  if (!origin || !environment.allowedOrigins.includes(origin)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/u.test(contentType))
    return false;

  const names = authCookieNames(environment);
  const csrfHeader = request.headers.get("x-rentproof-csrf");
  const csrfCookie = readUniqueCookie(request.headers.get("cookie"), names.csrf);
  return safeTokenEqual(csrfHeader, csrfCookie);
}

export function validateSelfHostedAuthBinaryMutation(
  request: Request,
  environment: AuthGuardEnvironment,
): boolean {
  if (!validateSelfHostedAuthRead(request, environment)) return false;
  const origin = request.headers.get("origin");
  if (!origin || !environment.allowedOrigins.includes(origin)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  if (request.headers.get("content-type")?.toLowerCase() !== "application/octet-stream") {
    return false;
  }
  const names = authCookieNames(environment);
  return safeTokenEqual(
    request.headers.get("x-rentproof-csrf"),
    readUniqueCookie(request.headers.get("cookie"), names.csrf),
  );
}

export function validateSelfHostedAuthFormMutation(
  request: Request,
  environment: AuthGuardEnvironment,
  submittedCsrf: string | null,
): boolean {
  if (!validateSelfHostedAuthRead(request, environment)) return false;
  const origin = request.headers.get("origin");
  if (!origin || !environment.allowedOrigins.includes(origin)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (!contentType?.startsWith("application/x-www-form-urlencoded")) return false;
  const csrfCookie = readUniqueCookie(
    request.headers.get("cookie"),
    authCookieNames(environment).csrf,
  );
  return safeTokenEqual(submittedCsrf, csrfCookie);
}

export function readUniqueCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const matches: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const candidateName = part.slice(0, separator).trim();
    if (candidateName !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
    matches.push(value);
  }
  const onlyMatch = matches[0];
  return matches.length === 1 && onlyMatch !== undefined ? onlyMatch : null;
}

function safeTokenEqual(left: string | null, right: string | null): boolean {
  if (!left || !right || !/^[A-Za-z0-9_-]{43}$/u.test(left)) return false;
  const leftBytes = Buffer.from(left, "ascii");
  const rightBytes = Buffer.from(right, "ascii");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
