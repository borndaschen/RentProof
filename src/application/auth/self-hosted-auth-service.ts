import { ActorContextSchema, type ActorContext } from "@/application/repositories";
import {
  ACCOUNT_REVERIFICATION_MS,
  ACCOUNT_SESSION_IDLE_MS,
  AccountPasswordSchema,
  PASSWORD_RESET_TTL_MS,
  normalizeEmailIdentifier,
  type AccountSessionCookie,
} from "./self-hosted-contracts";
import type {
  AuthClockPort,
  EnumerationResistancePort,
  OpaqueTokenPort,
  PasswordHasherPort,
  PasswordResetDeliveryPort,
  SelfHostedAuthRepositoryPort,
} from "./self-hosted-ports";

export type AuthenticationResult =
  | Readonly<{ status: "authenticated"; actor: ActorContext; cookie: AccountSessionCookie }>
  | Readonly<{ status: "invalid_credentials" }>;

export type SessionResolution =
  | Readonly<{
      status: "authenticated";
      actor: ActorContext;
      reverified: boolean;
      refreshCookie?: AccountSessionCookie;
    }>
  | Readonly<{ status: "signed_out" }>;

const BOUNDED_DUMMY_PASSWORD = "invalid-auth-input";

export type AuthRegistrationErrorCode =
  | "INPUT_NORMALIZATION"
  | "PASSWORD_HASH"
  | "ACCOUNT_CREATE"
  | "CREDENTIAL_LOOKUP"
  | "CHALLENGE_CREATE"
  | "DELIVERY"
  | "RESPONSE_FLOOR";

export type AuthRegistrationDatabaseDetail =
  | "POSTGRES_INSUFFICIENT_PRIVILEGE"
  | "POSTGRES_NOT_NULL_VIOLATION"
  | "POSTGRES_FOREIGN_KEY_VIOLATION"
  | "POSTGRES_UNIQUE_VIOLATION"
  | "POSTGRES_CHECK_VIOLATION"
  | "POSTGRES_UNDEFINED_TABLE"
  | "POSTGRES_UNDEFINED_COLUMN"
  | "POSTGRES_OTHER";

const registrationSqlStateDetails = Object.freeze({
  "42501": "POSTGRES_INSUFFICIENT_PRIVILEGE",
  "23502": "POSTGRES_NOT_NULL_VIOLATION",
  "23503": "POSTGRES_FOREIGN_KEY_VIOLATION",
  "23505": "POSTGRES_UNIQUE_VIOLATION",
  "23514": "POSTGRES_CHECK_VIOLATION",
  "42P01": "POSTGRES_UNDEFINED_TABLE",
  "42703": "POSTGRES_UNDEFINED_COLUMN",
} satisfies Readonly<Record<string, AuthRegistrationDatabaseDetail>>);

export class AuthRegistrationError extends Error {
  override readonly name = "AuthRegistrationError";
  readonly detail: AuthRegistrationDatabaseDetail | undefined;

  constructor(
    readonly code: AuthRegistrationErrorCode,
    detail?: AuthRegistrationDatabaseDetail,
  ) {
    super(code);
    this.detail = detail;
  }
}

export class SelfHostedAuthService {
  constructor(
    private readonly repository: SelfHostedAuthRepositoryPort,
    private readonly passwords: PasswordHasherPort,
    private readonly tokens: OpaqueTokenPort,
    private readonly resetDelivery: PasswordResetDeliveryPort,
    private readonly clock: AuthClockPort,
    private readonly dummyPasswordHash: string,
    private readonly enumerationResistance: EnumerationResistancePort,
  ) {}

  async register(
    input: Readonly<{ email: string; password: string; deliveryContextDigest: string }>,
  ): Promise<{ status: "accepted" }> {
    const startedAt = Date.now();
    try {
      let normalizedEmail: string;
      let password: string;
      try {
        normalizedEmail = normalizeEmailIdentifier(input.email);
        password = AccountPasswordSchema.parse(input.password);
      } catch {
        throw new AuthRegistrationError("INPUT_NORMALIZATION");
      }

      let passwordHash: string;
      try {
        passwordHash = await this.passwords.hash(password);
      } catch {
        throw new AuthRegistrationError("PASSWORD_HASH");
      }

      let created: Awaited<ReturnType<SelfHostedAuthRepositoryPort["createAccount"]>>;
      try {
        created = await this.repository.createAccount({
          normalizedEmail,
          passwordHash,
          now: this.clock.now(),
        });
      } catch (error: unknown) {
        throw new AuthRegistrationError("ACCOUNT_CREATE", deriveRegistrationDatabaseDetail(error));
      }

      let credential: Awaited<ReturnType<SelfHostedAuthRepositoryPort["findCredentialByEmail"]>>;
      try {
        credential =
          created.status === "created"
            ? await this.repository.findCredentialByUserId(created.userId)
            : await this.repository.findCredentialByEmail(normalizedEmail);
      } catch (error: unknown) {
        throw new AuthRegistrationError(
          "CREDENTIAL_LOOKUP",
          deriveRegistrationDatabaseDetail(error),
        );
      }

      if (credential?.status === "active" && !credential.emailVerified) {
        let issued: ReturnType<OpaqueTokenPort["issue"]>;
        try {
          const now = this.clock.now();
          issued = this.tokens.issue();
          await this.repository.createEmailVerificationChallenge({
            userId: credential.userId,
            tokenDigest: issued.digest,
            now,
            expiresAt: addMilliseconds(now, PASSWORD_RESET_TTL_MS),
          });
        } catch (error: unknown) {
          throw new AuthRegistrationError(
            "CHALLENGE_CREATE",
            deriveRegistrationDatabaseDetail(error),
          );
        }
        try {
          await this.resetDelivery.sendEmailVerification({
            normalizedEmail,
            rawToken: issued.rawToken,
            deliveryContextDigest: input.deliveryContextDigest,
          });
        } catch {
          throw new AuthRegistrationError("DELIVERY");
        }
      }
      return { status: "accepted" };
    } finally {
      try {
        await this.enumerationResistance.complete(startedAt);
      } catch {
        throw new AuthRegistrationError("RESPONSE_FLOOR");
      }
    }
  }

  async verifyEmail(rawToken: string): Promise<{ status: "verified" | "invalid_or_expired" }> {
    const tokenDigest = this.tokens.digest(rawToken);
    if (!tokenDigest) return { status: "invalid_or_expired" };
    const result = await this.repository.consumeEmailVerificationChallenge({
      tokenDigest,
      now: this.clock.now(),
    });
    return { status: result.status };
  }

  async authenticate(
    input: Readonly<{ email: string; password: string }>,
  ): Promise<AuthenticationResult> {
    const startedAt = Date.now();
    try {
      let normalizedEmail: string;
      let password: string;
      try {
        normalizedEmail = normalizeEmailIdentifier(input.email);
        password = AccountPasswordSchema.parse(input.password);
      } catch {
        await this.passwords.verify(this.dummyPasswordHash, BOUNDED_DUMMY_PASSWORD);
        return { status: "invalid_credentials" };
      }
      const credential = await this.repository.findCredentialByEmail(normalizedEmail);
      const verified = await this.passwords.verify(
        credential?.passwordHash ?? this.dummyPasswordHash,
        password,
      );
      if (!credential || !verified || credential.status !== "active" || !credential.emailVerified) {
        return { status: "invalid_credentials" };
      }

      const now = this.clock.now();
      if (this.passwords.needsRehash(credential.passwordHash)) {
        await this.repository.replacePasswordHash(
          credential.userId,
          await this.passwords.hash(password),
          now,
        );
      }
      const issued = this.tokens.issue();
      const session = await this.repository.createSession({
        userId: credential.userId,
        tokenDigest: issued.digest,
        now,
        idleExpiresAt: addMilliseconds(now, ACCOUNT_SESSION_IDLE_MS),
      });
      return {
        status: "authenticated",
        actor: ActorContextSchema.parse({
          kind: "user",
          userId: credential.userId,
          sessionId: session.sessionId,
        }),
        cookie: { token: issued.rawToken, maxAgeSeconds: ACCOUNT_SESSION_IDLE_MS / 1_000 },
      };
    } finally {
      await this.enumerationResistance.complete(startedAt);
    }
  }

  async resolveSession(
    rawToken: string | undefined,
    eligibleActivity = false,
  ): Promise<SessionResolution> {
    if (!rawToken) return { status: "signed_out" };
    const tokenDigest = this.tokens.digest(rawToken);
    if (!tokenDigest) return { status: "signed_out" };
    const now = this.clock.now();
    const session = eligibleActivity
      ? await this.repository.resolveAndTouchSession({
          tokenDigest,
          now,
          idleExpiresAt: addMilliseconds(now, ACCOUNT_SESSION_IDLE_MS),
        })
      : await this.repository.resolveSessionWithoutTouch({ tokenDigest, now });
    if (!session) return { status: "signed_out" };
    return {
      status: "authenticated",
      actor: ActorContextSchema.parse({
        kind: "user",
        userId: session.userId,
        sessionId: session.sessionId,
      }),
      reverified: Boolean(session.reverifiedUntil && session.reverifiedUntil > now),
      ...(eligibleActivity
        ? {
            refreshCookie: {
              token: rawToken,
              maxAgeSeconds: ACCOUNT_SESSION_IDLE_MS / 1_000,
            },
          }
        : {}),
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    const tokenDigest = rawToken ? this.tokens.digest(rawToken) : null;
    if (tokenDigest) await this.repository.revokeSession(tokenDigest, this.clock.now());
  }

  async reverify(
    input: Readonly<{ rawToken: string; password: string }>,
  ): Promise<
    | Readonly<{ status: "reverified"; cookie: AccountSessionCookie }>
    | Readonly<{ status: "failed" }>
  > {
    const tokenDigest = this.tokens.digest(input.rawToken);
    if (!tokenDigest) return { status: "failed" };
    let password: string;
    try {
      password = AccountPasswordSchema.parse(input.password);
    } catch {
      await this.passwords.verify(this.dummyPasswordHash, BOUNDED_DUMMY_PASSWORD);
      return { status: "failed" };
    }
    const now = this.clock.now();
    const session = await this.repository.resolveAndTouchSession({
      tokenDigest,
      now,
      idleExpiresAt: addMilliseconds(now, ACCOUNT_SESSION_IDLE_MS),
    });
    if (!session) return { status: "failed" };
    const credential = await this.repository.findCredentialByUserId(session.userId);
    const verified = await this.passwords.verify(
      credential?.passwordHash ?? this.dummyPasswordHash,
      password,
    );
    if (!credential || credential.status !== "active" || !credential.emailVerified || !verified) {
      return { status: "failed" };
    }
    const replacement = this.tokens.issue();
    const rotated = await this.repository.rotateSessionAfterReverification({
      currentTokenDigest: tokenDigest,
      replacementTokenDigest: replacement.digest,
      userId: session.userId,
      now,
      idleExpiresAt: addMilliseconds(now, ACCOUNT_SESSION_IDLE_MS),
      reverifiedUntil: addMilliseconds(now, ACCOUNT_REVERIFICATION_MS),
    });
    return rotated
      ? {
          status: "reverified",
          cookie: {
            token: replacement.rawToken,
            maxAgeSeconds: ACCOUNT_SESSION_IDLE_MS / 1_000,
          },
        }
      : { status: "failed" };
  }

  async requestPasswordReset(
    input: Readonly<{
      email: string;
      deliveryContextDigest: string;
    }>,
  ): Promise<{ status: "accepted" }> {
    const startedAt = Date.now();
    try {
      let normalizedEmail: string;
      try {
        normalizedEmail = normalizeEmailIdentifier(input.email);
      } catch {
        return { status: "accepted" };
      }
      const credential = await this.repository.findCredentialByEmail(normalizedEmail);
      if (credential?.status === "active" && credential.emailVerified) {
        const now = this.clock.now();
        const issued = this.tokens.issue();
        await this.repository.createPasswordResetChallenge({
          userId: credential.userId,
          tokenDigest: issued.digest,
          now,
          expiresAt: addMilliseconds(now, PASSWORD_RESET_TTL_MS),
        });
        await this.resetDelivery.sendPasswordReset({
          normalizedEmail,
          rawToken: issued.rawToken,
          deliveryContextDigest: input.deliveryContextDigest,
        });
      }
      return { status: "accepted" };
    } finally {
      await this.enumerationResistance.complete(startedAt);
    }
  }

  async completePasswordReset(
    input: Readonly<{
      rawToken: string;
      newPassword: string;
    }>,
  ): Promise<{ status: "completed" | "invalid_or_expired" }> {
    const tokenDigest = this.tokens.digest(input.rawToken);
    if (!tokenDigest) return { status: "invalid_or_expired" };
    const password = AccountPasswordSchema.parse(input.newPassword);
    const now = this.clock.now();
    const result = await this.repository.consumePasswordResetChallenge({
      tokenDigest,
      passwordHash: await this.passwords.hash(password),
      now,
    });
    return { status: result.status };
  }

  async disableAccount(userId: string): Promise<boolean> {
    return this.repository.disableAccountAndRevokeSessions(userId, this.clock.now());
  }
}

function addMilliseconds(input: Date, milliseconds: number): Date {
  return new Date(input.getTime() + milliseconds);
}

function deriveRegistrationDatabaseDetail(
  error: unknown,
): AuthRegistrationDatabaseDetail | undefined {
  const sqlState = safeStringProperty(error, "code");
  if (!sqlState || !/^[0-9A-Z]{5}$/u.test(sqlState)) return undefined;
  if (Object.hasOwn(registrationSqlStateDetails, sqlState)) {
    return registrationSqlStateDetails[sqlState as keyof typeof registrationSqlStateDetails];
  }
  return "POSTGRES_OTHER";
}

function safeStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const candidate = Reflect.get(value, property) as unknown;
    return typeof candidate === "string" ? candidate : undefined;
  } catch {
    return undefined;
  }
}
