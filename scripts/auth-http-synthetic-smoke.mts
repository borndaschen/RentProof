import { randomBytes, randomUUID } from "node:crypto";
import {
  parsePostgresDatabaseConfig,
  PostgresConfigurationError,
} from "../src/adapters/database/postgres/config.ts";
import { createPostgresRuntime } from "../src/adapters/database/postgres/runtime.ts";

const ORIGIN = "http://127.0.0.1:3000";
const SESSION_COOKIE = "rentproof_account_dev";
const CSRF_COOKIE = "rentproof_csrf_dev";

class AuthHttpSmokeError extends Error {
  override readonly name = "AuthHttpSmokeError";
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type AuthHttpSmokePhase =
  | "AUTH_HTTP_SMOKE_SESSION_BOOTSTRAP_FAILED"
  | "AUTH_HTTP_SMOKE_RUNTIME_PROBE_FAILED"
  | "AUTH_HTTP_SMOKE_REGISTER_FAILED"
  | "AUTH_HTTP_SMOKE_MAILBOX_VERIFY_FAILED"
  | "AUTH_HTTP_SMOKE_VERIFY_FAILED"
  | "AUTH_HTTP_SMOKE_LOGIN_FAILED"
  | "AUTH_HTTP_SMOKE_PASSIVE_FAILED"
  | "AUTH_HTTP_SMOKE_HISTORY_SLIDE_FAILED"
  | "AUTH_HTTP_SMOKE_LOGOUT_FAILED"
  | "AUTH_HTTP_SMOKE_RESET_REQUEST_FAILED"
  | "AUTH_HTTP_SMOKE_RESET_MAILBOX_FAILED"
  | "AUTH_HTTP_SMOKE_RESET_COMPLETE_FAILED"
  | "AUTH_HTTP_SMOKE_REPLAY_FAILED";

type AuthHttpPhaseName =
  | "SESSION_BOOTSTRAP"
  | "RUNTIME_PROBE"
  | "REGISTER"
  | "MAILBOX_VERIFY"
  | "VERIFY"
  | "LOGIN"
  | "PASSIVE"
  | "HISTORY_SLIDE"
  | "LOGOUT"
  | "RESET_REQUEST"
  | "RESET_MAILBOX"
  | "RESET_COMPLETE"
  | "REPLAY";

class CookieJar {
  readonly #cookies = new Map<string, string>();

  apply(response: Response): readonly string[] {
    const values = response.headers.getSetCookie();
    for (const value of values) {
      const parts = value.split(";").map((part) => part.trim());
      const pair = parts[0];
      if (!pair) throw new AuthHttpSmokeError("AUTH_HTTP_SMOKE_HTTP_ASSERTION_FAILED");
      const separator = pair.indexOf("=");
      if (separator <= 0) throw new AuthHttpSmokeError("AUTH_HTTP_SMOKE_HTTP_ASSERTION_FAILED");
      const name = pair.slice(0, separator);
      const cookieValue = pair.slice(separator + 1);
      const deleted = cookieValue === "" || parts.some((part) => /^max-age=0$/iu.test(part));
      if (deleted) this.#cookies.delete(name);
      else this.#cookies.set(name, cookieValue);
    }
    return values;
  }

  get(name: string): string | undefined {
    return this.#cookies.get(name);
  }

  header(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function assertSmoke(condition: boolean, database = false): asserts condition {
  if (!condition) {
    throw new AuthHttpSmokeError(
      database
        ? "AUTH_HTTP_SMOKE_DATABASE_ASSERTION_FAILED"
        : "AUTH_HTTP_SMOKE_HTTP_ASSERTION_FAILED",
    );
  }
}

async function main(): Promise<void> {
  const config = parsePostgresDatabaseConfig(process.env);
  if (config.role !== "app" || config.environment !== "synthetic_demo") {
    throw new AuthHttpSmokeError("AUTH_HTTP_SMOKE_APP_ROLE_REQUIRED");
  }
  if (
    process.env.RENTPROOF_AUTH_MODE !== "self_hosted" ||
    process.env.RENTPROOF_DEPLOYMENT_PROFILE !== "local_development" ||
    process.env.RENTPROOF_PUBLIC_ORIGIN !== ORIGIN ||
    process.env.RENTPROOF_ALLOW_REAL_DATA !== "false" ||
    process.env.RENTPROOF_LLM_MODE !== "fixture"
  ) {
    throw new AuthHttpSmokeError("AUTH_HTTP_SMOKE_CONFIGURATION_INVALID");
  }

  const suffix = randomUUID().replaceAll("-", "");
  const email = `synthetic-auth-${suffix}@example.test`;
  const password = `A1!${randomBytes(24).toString("base64url")}`;
  const replacementPassword = `B2!${randomBytes(24).toString("base64url")}`;
  const replayPassword = `C3!${randomBytes(24).toString("base64url")}`;
  const jar = new CookieJar();
  const postgres = createPostgresRuntime(config);
  let userId: string | undefined;
  let smokeFailure: unknown;
  let phase: AuthHttpSmokePhase = "AUTH_HTTP_SMOKE_SESSION_BOOTSTRAP_FAILED";

  try {
    try {
      let csrf = await refreshSession(jar, "signed_out");

      phase = "AUTH_HTTP_SMOKE_RUNTIME_PROBE_FAILED";
      expectStatus(
        await postJson(jar, csrf, "/api/auth/login", { email, password }),
        401,
        "RUNTIME_PROBE",
      );

      phase = "AUTH_HTTP_SMOKE_REGISTER_FAILED";
      const csrfCookie = jar.get(CSRF_COOKIE);
      if (!csrfCookie) throw new AuthHttpSmokeError("AUTH_HTTP_SMOKE_REGISTER_CSRF_COOKIE_MISSING");
      if (csrfCookie !== csrf)
        throw new AuthHttpSmokeError("AUTH_HTTP_SMOKE_REGISTER_CSRF_COOKIE_MISMATCH");
      if (!jar.get("rentproof_preauth_dev"))
        throw new AuthHttpSmokeError("AUTH_HTTP_SMOKE_REGISTER_PREAUTH_COOKIE_MISSING");
      expectStatus(
        await postJson(jar, csrf, "/api/auth/register", {
          email,
          password,
          demoPolicyAcknowledged: true,
        }),
        202,
        "REGISTER",
      );
      phase = "AUTH_HTTP_SMOKE_MAILBOX_VERIFY_FAILED";
      const verificationCode = await readMailbox(
        jar,
        csrf,
        email,
        "verification",
        "MAILBOX_VERIFY",
      );
      phase = "AUTH_HTTP_SMOKE_VERIFY_FAILED";
      expectStatus(
        await postJson(jar, csrf, "/api/auth/registration/verify", {
          code: verificationCode,
        }),
        202,
        "VERIFY",
      );

      const credential = await postgres.database
        .selectFrom("auth_credentials")
        .select(["user_id", "email_verified_at"])
        .where("email_normalized", "=", email)
        .executeTakeFirst();
      assertSmoke(Boolean(credential?.email_verified_at), true);
      userId = credential?.user_id;
      assertSmoke(Boolean(userId), true);

      phase = "AUTH_HTTP_SMOKE_LOGIN_FAILED";
      const login = await postJson(jar, csrf, "/api/auth/login", { email, password });
      expectStatus(login, 200, "LOGIN");
      jar.apply(login);
      const sessionToken = jar.get(SESSION_COOKIE);
      assertSmoke(Boolean(sessionToken) && /^[A-Za-z0-9_-]{43}$/u.test(sessionToken));

      phase = "AUTH_HTTP_SMOKE_PASSIVE_FAILED";
      const beforePassive = await latestSession(postgres.database, userId);
      assertSmoke(Boolean(beforePassive), true);
      const passive = await fetch(`${ORIGIN}/api/auth/session`, {
        headers: requestHeaders(jar, false),
        redirect: "error",
      });
      const passiveSetCookies = jar.apply(passive);
      expectStatus(passive, 200, "PASSIVE");
      const passiveBody = (await passive.json()) as { status?: unknown; csrfToken?: unknown };
      assertSmoke(passiveBody.status === "authenticated");
      assertSmoke(typeof passiveBody.csrfToken === "string");
      csrf = passiveBody.csrfToken;
      assertSmoke(!passiveSetCookies.some((header) => header.startsWith(`${SESSION_COOKIE}=`)));
      const afterPassive = await sessionById(postgres.database, beforePassive.id);
      assertSmoke(
        afterPassive?.version === beforePassive.version &&
          afterPassive.last_used_at.getTime() === beforePassive.last_used_at.getTime(),
        true,
      );

      phase = "AUTH_HTTP_SMOKE_HISTORY_SLIDE_FAILED";
      const history = await fetch(`${ORIGIN}/api/history`, {
        headers: requestHeaders(jar, false),
        redirect: "error",
      });
      const historySetCookies = jar.apply(history);
      expectStatus(history, 200, "HISTORY_SLIDE");
      assertSmoke(
        historySetCookies.some(
          (header) => header.startsWith(`${SESSION_COOKIE}=`) && !/max-age=0/iu.test(header),
        ),
      );
      const afterHistory = await sessionById(postgres.database, beforePassive.id);
      assertSmoke(
        Boolean(afterHistory) &&
          afterHistory.version === beforePassive.version + 1 &&
          afterHistory.last_used_at.getTime() >= beforePassive.last_used_at.getTime(),
        true,
      );

      phase = "AUTH_HTTP_SMOKE_LOGOUT_FAILED";
      const logout = await postJson(jar, csrf, "/api/auth/logout", {});
      jar.apply(logout);
      expectStatus(logout, 204, "LOGOUT");
      assertSmoke(jar.get(SESSION_COOKIE) === undefined);
      const revoked = await sessionById(postgres.database, beforePassive.id);
      assertSmoke(Boolean(revoked?.revoked_at), true);

      phase = "AUTH_HTTP_SMOKE_RESET_REQUEST_FAILED";
      expectStatus(
        await postJson(jar, csrf, "/api/auth/password-reset/request", { email }),
        202,
        "RESET_REQUEST",
      );
      phase = "AUTH_HTTP_SMOKE_RESET_MAILBOX_FAILED";
      const resetCode = await readMailbox(jar, csrf, email, "password_reset", "RESET_MAILBOX");
      phase = "AUTH_HTTP_SMOKE_RESET_COMPLETE_FAILED";
      const reset = await postJson(jar, csrf, "/api/auth/password-reset/complete", {
        code: resetCode,
        newPassword: replacementPassword,
      });
      jar.apply(reset);
      expectStatus(reset, 202, "RESET_COMPLETE");
      phase = "AUTH_HTTP_SMOKE_REPLAY_FAILED";
      const replay = await postJson(jar, csrf, "/api/auth/password-reset/complete", {
        code: resetCode,
        newPassword: replayPassword,
      });
      jar.apply(replay);
      expectStatus(replay, 202, "REPLAY");

      const replacementLogin = await postJson(jar, csrf, "/api/auth/login", {
        email,
        password: replacementPassword,
      });
      jar.apply(replacementLogin);
      expectStatus(replacementLogin, 200, "REPLAY");
      const replayLogin = await postJson(jar, csrf, "/api/auth/login", {
        email,
        password: replayPassword,
      });
      expectStatus(replayLogin, 401, "REPLAY");
    } catch (error: unknown) {
      smokeFailure =
        error instanceof AuthHttpSmokeError &&
        error.code !== "AUTH_HTTP_SMOKE_HTTP_ASSERTION_FAILED"
          ? error
          : new AuthHttpSmokeError(phase);
    }
  } finally {
    try {
      const credential = await postgres.database
        .selectFrom("auth_credentials")
        .select("user_id")
        .where("email_normalized", "=", email)
        .executeTakeFirst();
      const exactUserId = userId ?? credential?.user_id;
      if (exactUserId) {
        await postgres.database
          .deleteFrom("internal_users")
          .where("id", "=", exactUserId)
          .where("clerk_user_id", "is", null)
          .execute();
      }
      const residues = await Promise.all([
        postgres.database
          .selectFrom("auth_credentials")
          .select((expression) => expression.fn.countAll<number>().as("count"))
          .where("email_normalized", "=", email)
          .executeTakeFirstOrThrow(),
        exactUserId
          ? postgres.database
              .selectFrom("internal_users")
              .select((expression) => expression.fn.countAll<number>().as("count"))
              .where("id", "=", exactUserId)
              .executeTakeFirstOrThrow()
          : Promise.resolve({ count: 0 }),
        exactUserId
          ? postgres.database
              .selectFrom("auth_sessions")
              .select((expression) => expression.fn.countAll<number>().as("count"))
              .where("user_id", "=", exactUserId)
              .executeTakeFirstOrThrow()
          : Promise.resolve({ count: 0 }),
        exactUserId
          ? postgres.database
              .selectFrom("auth_password_reset_challenges")
              .select((expression) => expression.fn.countAll<number>().as("count"))
              .where("user_id", "=", exactUserId)
              .executeTakeFirstOrThrow()
          : Promise.resolve({ count: 0 }),
        exactUserId
          ? postgres.database
              .selectFrom("auth_email_verification_challenges")
              .select((expression) => expression.fn.countAll<number>().as("count"))
              .where("user_id", "=", exactUserId)
              .executeTakeFirstOrThrow()
          : Promise.resolve({ count: 0 }),
      ]);
      if (residues.some((row) => Number(row.count) !== 0)) {
        smokeFailure = new AuthHttpSmokeError("AUTH_HTTP_SMOKE_CLEANUP_FAILED");
      }
    } catch {
      smokeFailure = new AuthHttpSmokeError("AUTH_HTTP_SMOKE_CLEANUP_FAILED");
    } finally {
      await postgres.close();
    }
  }

  if (smokeFailure !== undefined) throw smokeFailure;
  process.stdout.write("AUTH_HTTP_SYNTHETIC_SMOKE_OK\n");
}

function requestHeaders(jar: CookieJar, mutation: boolean, csrf?: string): HeadersInit {
  return {
    Accept: "application/json",
    ...(jar.header() ? { Cookie: jar.header() } : {}),
    ...(mutation
      ? {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
          "X-RentProof-CSRF": csrf ?? "",
        }
      : {}),
  };
}

async function refreshSession(jar: CookieJar, expected: "signed_out" | "authenticated") {
  const response = await fetch(`${ORIGIN}/api/auth/session`, {
    headers: requestHeaders(jar, false),
    redirect: "error",
  });
  jar.apply(response);
  expectStatus(response, 200, "SESSION_BOOTSTRAP");
  const body = (await response.json()) as { status?: unknown; csrfToken?: unknown };
  assertSmoke(body.status === expected && typeof body.csrfToken === "string");
  return body.csrfToken;
}

async function postJson(jar: CookieJar, csrf: string, path: string, body: unknown) {
  return fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: requestHeaders(jar, true, csrf),
    body: JSON.stringify(body),
    redirect: "error",
  });
}

async function readMailbox(
  jar: CookieJar,
  csrf: string,
  email: string,
  kind: "verification" | "password_reset",
  phase: "MAILBOX_VERIFY" | "RESET_MAILBOX",
): Promise<string> {
  const response = await fetch(`${ORIGIN}/api/auth/dev-mailbox`, {
    method: "POST",
    headers: {
      Accept: "text/html",
      Cookie: jar.header(),
      Origin: ORIGIN,
      "Content-Type": "application/x-www-form-urlencoded",
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams({ csrf, email, kind }).toString(),
    redirect: "error",
  });
  expectStatus(response, 200, phase);
  const code = /<code>([A-Za-z0-9_-]{43})<\/code>/u.exec(await response.text())?.[1];
  assertSmoke(Boolean(code));
  return code;
}

function expectStatus(response: Response, expected: number, phase: AuthHttpPhaseName): void {
  if (response.status !== expected) {
    throw new AuthHttpSmokeError(`AUTH_HTTP_SMOKE_${phase}_STATUS_${response.status}`);
  }
}

async function latestSession(
  database: ReturnType<typeof createPostgresRuntime>["database"],
  userId: string,
) {
  return database
    .selectFrom("auth_sessions")
    .select(["id", "last_used_at", "version", "revoked_at"])
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
}

async function sessionById(
  database: ReturnType<typeof createPostgresRuntime>["database"],
  sessionId: string,
) {
  return database
    .selectFrom("auth_sessions")
    .select(["id", "last_used_at", "version", "revoked_at"])
    .where("id", "=", sessionId)
    .executeTakeFirst();
}

try {
  await main();
} catch (error: unknown) {
  const reason =
    error instanceof PostgresConfigurationError || error instanceof AuthHttpSmokeError
      ? error.code
      : "AUTH_HTTP_SYNTHETIC_SMOKE_FAILED";
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}
