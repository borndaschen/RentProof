import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { AccountSessionCookie, AuthRegistrationDatabaseDetail } from "@/application/auth";
import type { ServerEnvironment } from "@/server/env";
import {
  authCookieNames,
  diagnoseSelfHostedAuthRead,
  isSelfHostedAuthRouteEnabled,
  readUniqueCookie,
  validateSelfHostedAuthMutation,
} from "./request-guard";
import { selfHostedAuthRateLimiter } from "./rate-limit";

export const AUTH_REQUEST_MAX_BYTES = 4_096;

type AuthRegistrationRepositoryPhase = "ACCOUNT_CREATE" | "CREDENTIAL_LOOKUP" | "CHALLENGE_CREATE";

export type AuthRegisterFailureReason =
  | "POSTGRES_INSUFFICIENT_PRIVILEGE"
  | "POSTGRES_NOT_NULL_VIOLATION"
  | "POSTGRES_FOREIGN_KEY_VIOLATION"
  | "POSTGRES_UNIQUE_VIOLATION"
  | "POSTGRES_CHECK_VIOLATION"
  | "POSTGRES_UNDEFINED_TABLE"
  | "POSTGRES_UNDEFINED_COLUMN"
  | "POSTGRES_OTHER"
  | "PASSWORD_HASHING"
  | "CONFIGURATION"
  | "DELIVERY"
  | "REGISTRATION_INPUT_NORMALIZATION"
  | "REGISTRATION_PASSWORD_HASH"
  | "REGISTRATION_ACCOUNT_CREATE"
  | "REGISTRATION_CREDENTIAL_LOOKUP"
  | "REGISTRATION_CHALLENGE_CREATE"
  | "REGISTRATION_DELIVERY"
  | "REGISTRATION_RESPONSE_FLOOR"
  | `REGISTRATION_${AuthRegistrationRepositoryPhase}_${AuthRegistrationDatabaseDetail}`
  | "UNKNOWN";

const postgresSqlStateReasons = Object.freeze({
  "42501": "POSTGRES_INSUFFICIENT_PRIVILEGE",
  "23502": "POSTGRES_NOT_NULL_VIOLATION",
  "23503": "POSTGRES_FOREIGN_KEY_VIOLATION",
  "23505": "POSTGRES_UNIQUE_VIOLATION",
  "23514": "POSTGRES_CHECK_VIOLATION",
  "42P01": "POSTGRES_UNDEFINED_TABLE",
  "42703": "POSTGRES_UNDEFINED_COLUMN",
} satisfies Readonly<Record<string, AuthRegisterFailureReason>>);

const registrationPhaseReasons = Object.freeze({
  INPUT_NORMALIZATION: "REGISTRATION_INPUT_NORMALIZATION",
  PASSWORD_HASH: "REGISTRATION_PASSWORD_HASH",
  ACCOUNT_CREATE: "REGISTRATION_ACCOUNT_CREATE",
  CREDENTIAL_LOOKUP: "REGISTRATION_CREDENTIAL_LOOKUP",
  CHALLENGE_CREATE: "REGISTRATION_CHALLENGE_CREATE",
  DELIVERY: "REGISTRATION_DELIVERY",
  RESPONSE_FLOOR: "REGISTRATION_RESPONSE_FLOOR",
} satisfies Readonly<Record<string, AuthRegisterFailureReason>>);

const registrationDatabaseDetails = new Set<AuthRegistrationDatabaseDetail>([
  "POSTGRES_INSUFFICIENT_PRIVILEGE",
  "POSTGRES_NOT_NULL_VIOLATION",
  "POSTGRES_FOREIGN_KEY_VIOLATION",
  "POSTGRES_UNIQUE_VIOLATION",
  "POSTGRES_CHECK_VIOLATION",
  "POSTGRES_UNDEFINED_TABLE",
  "POSTGRES_UNDEFINED_COLUMN",
  "POSTGRES_OTHER",
]);

const registrationRepositoryPhases = new Set<AuthRegistrationRepositoryPhase>([
  "ACCOUNT_CREATE",
  "CREDENTIAL_LOOKUP",
  "CHALLENGE_CREATE",
]);

export function classifyAuthRegisterFailure(error: unknown): AuthRegisterFailureReason {
  const code = safeErrorStringProperty(error, "code");
  if (code && Object.hasOwn(postgresSqlStateReasons, code)) {
    return postgresSqlStateReasons[code as keyof typeof postgresSqlStateReasons];
  }
  const name = safeErrorName(error);
  if (name === "AuthRegistrationError" && code && Object.hasOwn(registrationPhaseReasons, code)) {
    const detail = safeErrorStringProperty(error, "detail");
    if (
      registrationRepositoryPhases.has(code as AuthRegistrationRepositoryPhase) &&
      registrationDatabaseDetails.has(detail as AuthRegistrationDatabaseDetail)
    ) {
      return `REGISTRATION_${code as AuthRegistrationRepositoryPhase}_${detail as AuthRegistrationDatabaseDetail}`;
    }
    return registrationPhaseReasons[code as keyof typeof registrationPhaseReasons];
  }
  if (
    name === "DatabaseError" ||
    name === "PostgresError" ||
    name === "PostgresConfigurationError"
  ) {
    return name === "PostgresConfigurationError" ? "CONFIGURATION" : "POSTGRES_OTHER";
  }
  if (name === "Argon2Error" || name === "PasswordHashError") return "PASSWORD_HASHING";
  if (name === "AuthRuntimeConfigurationError" || name === "ZodError") return "CONFIGURATION";
  if (name === "LocalSyntheticOutboxError" || name === "AuthDeliveryError") return "DELIVERY";
  return "UNKNOWN";
}

export const LoginBodySchema = z
  .object({ email: z.string().max(254), password: z.string().max(128) })
  .strict();
export const RegisterBodySchema = LoginBodySchema.extend({
  demoPolicyAcknowledged: z.literal(true),
}).strict();
export const CodeBodySchema = z.object({ code: z.string().regex(/^\d{6}$/u) }).strict();
export const ResetRequestBodySchema = z.object({ email: z.string().max(254) }).strict();
export const ResetCompleteBodySchema = z
  .object({
    code: z.string().regex(/^\d{6}$/u),
    newPassword: z.string().max(128),
  })
  .strict();

export interface AuthCookieStore {
  get(name: string): { value: string } | undefined;
  set(options: {
    name: string;
    value: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict";
    path: "/";
    maxAge: number;
    expires?: Date;
  }): void;
  delete(name: string): void;
}

export function guardAuthRead(
  request: Request,
  environment: ServerEnvironment,
  action: string,
): Response | null {
  const diagnosis = diagnoseSelfHostedAuthRead(request, environment);
  if (!diagnosis.ok) {
    if (
      environment.RENTPROOF_AUTH_MODE === "self_hosted" &&
      ["local_development", "lan_secure_demo"].includes(environment.RENTPROOF_DEPLOYMENT_PROFILE)
    ) {
      console.warn(`AUTH_READ_REJECTED_${diagnosis.reason}`);
    }
    return authDisabledResponse();
  }
  return rateLimitResponse(request, environment, action);
}

export function guardAuthMutation(
  request: Request,
  environment: ServerEnvironment,
  action: string,
): Response | null {
  if (!validateSelfHostedAuthMutation(request, environment)) return authDisabledResponse();
  return rateLimitResponse(request, environment, action);
}

export function authDisabledResponse(): Response {
  return Response.json(
    { error: { code: "AUTH_ROUTE_UNAVAILABLE", message: "此模式未開放帳戶操作。" } },
    { status: 404, headers: privateHeaders() },
  );
}

export function authUnavailableResponse(): Response {
  return Response.json(
    { error: { code: "AUTH_TEMPORARILY_UNAVAILABLE", message: "帳戶服務目前無法使用。" } },
    { status: 503, headers: privateHeaders() },
  );
}

export function authInvalidResponse(): Response {
  return Response.json(
    { error: { code: "AUTH_REQUEST_NOT_ACCEPTED", message: "無法完成要求。" } },
    { status: 401, headers: privateHeaders() },
  );
}

export function authMalformedResponse(): Response {
  return Response.json(
    { error: { code: "AUTH_REQUEST_INVALID", message: "無法完成要求。" } },
    { status: 400, headers: privateHeaders() },
  );
}

export function genericAcceptedResponse(): Response {
  return Response.json(
    { status: "accepted", message: "若要求有效，系統已完成處理。" },
    { status: 202, headers: privateHeaders() },
  );
}

export async function readBoundedAuthJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > AUTH_REQUEST_MAX_BYTES)
  ) {
    throw new Error("AUTH_REQUEST_TOO_LARGE");
  }
  if (!request.body) throw new Error("AUTH_REQUEST_INVALID");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AUTH_REQUEST_MAX_BYTES) {
        await reader.cancel();
        throw new Error("AUTH_REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("AUTH_REQUEST_INVALID");
  return JSON.parse(text) as unknown;
}

export function issueCsrfCookie(
  cookieStore: AuthCookieStore,
  environment: ServerEnvironment,
): string {
  const token = randomBytes(32).toString("base64url");
  const names = authCookieNames(environment);
  cookieStore.set({
    name: names.csrf,
    value: token,
    httpOnly: false,
    secure: names.secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60,
  });
  return token;
}

export function ensurePreAuthCookie(
  request: Request,
  cookieStore: AuthCookieStore,
  environment: ServerEnvironment,
): string {
  const names = authCookieNames(environment);
  const existing = readUniqueCookie(request.headers.get("cookie"), names.preauth);
  if (existing) return existing;
  const token = randomBytes(32).toString("base64url");
  cookieStore.set({
    name: names.preauth,
    value: token,
    httpOnly: true,
    secure: names.secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60,
  });
  return token;
}

export function readPreAuthCookie(
  request: Request,
  environment: ServerEnvironment,
): string | undefined {
  return (
    readUniqueCookie(request.headers.get("cookie"), authCookieNames(environment).preauth) ??
    undefined
  );
}

export function readSessionCookie(
  request: Request,
  environment: ServerEnvironment,
): string | undefined {
  return (
    readUniqueCookie(request.headers.get("cookie"), authCookieNames(environment).session) ??
    undefined
  );
}

export function setSessionCookie(
  cookieStore: AuthCookieStore,
  environment: ServerEnvironment,
  session: AccountSessionCookie,
): void {
  const names = authCookieNames(environment);
  cookieStore.set({
    name: names.session,
    value: session.token,
    httpOnly: true,
    secure: names.secure,
    sameSite: "strict",
    path: "/",
    maxAge: session.maxAgeSeconds,
    expires: new Date(Date.now() + session.maxAgeSeconds * 1_000),
  });
}

export function clearSessionCookie(
  cookieStore: AuthCookieStore,
  environment: ServerEnvironment,
): void {
  const names = authCookieNames(environment);
  cookieStore.set({
    name: names.session,
    value: "",
    httpOnly: true,
    secure: names.secure,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export function privateHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
}

function rateLimitResponse(
  request: Request,
  environment: ServerEnvironment,
  action: string,
): Response | null {
  const sourceIp =
    environment.RENTPROOF_DEPLOYMENT_PROFILE === "local_development"
      ? "127.0.0.1"
      : request.headers.get("x-rentproof-source-ip");
  if (sourceIp === null || isIP(sourceIp) !== 4) return rateLimitedResponse(1);

  const names = authCookieNames(environment);
  const actorToken =
    readUniqueCookie(request.headers.get("cookie"), names.session) ??
    readUniqueCookie(request.headers.get("cookie"), names.preauth) ??
    readUniqueCookie(request.headers.get("cookie"), names.reset);
  const actorRef = actorToken
    ? createHash("sha256").update(actorToken, "ascii").digest("hex")
    : `source-${sourceIp}`;
  const sourceResult = selfHostedAuthRateLimiter.take(`source:${action}:${sourceIp}`);
  if (!sourceResult.allowed) {
    return rateLimitedResponse(sourceResult.retryAfterSeconds ?? 1);
  }
  const actorResult = selfHostedAuthRateLimiter.take(`actor:${action}:${actorRef}`);
  if (actorResult.allowed) return null;
  return rateLimitedResponse(actorResult.retryAfterSeconds ?? 1);
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: { code: "AUTH_RATE_LIMITED", message: "要求過於頻繁，請稍後再試。" } },
    {
      status: 429,
      headers: { ...privateHeaders(), "Retry-After": String(retryAfterSeconds) },
    },
  );
}

export function assertAuthRuntimeEnabled(environment: ServerEnvironment): void {
  if (!isSelfHostedAuthRouteEnabled(environment)) throw new Error("AUTH_FEATURE_DISABLED");
}

function safeErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  try {
    return typeof error.name === "string" ? error.name : null;
  } catch {
    return null;
  }
}

function safeErrorStringProperty(error: unknown, key: string): string | null {
  if (typeof error !== "object" || error === null) return null;
  try {
    const value = Reflect.get(error, key) as unknown;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
