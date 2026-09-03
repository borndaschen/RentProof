import type {
  AccountCredential,
  AccountSessionRecord,
  IssuedOpaqueToken,
} from "./self-hosted-contracts";

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  needsRehash(passwordHash: string): boolean;
}

export interface OpaqueTokenPort {
  issue(): IssuedOpaqueToken;
  digest(rawToken: string): string | null;
}

export interface SelfHostedAuthRepositoryPort {
  createAccount(
    input: Readonly<{
      normalizedEmail: string;
      passwordHash: string;
      now: Date;
    }>,
  ): Promise<{ status: "created"; userId: string } | { status: "already_exists" }>;
  findCredentialByEmail(normalizedEmail: string): Promise<AccountCredential | null>;
  findCredentialByUserId(userId: string): Promise<AccountCredential | null>;
  replacePasswordHash(userId: string, passwordHash: string, now: Date): Promise<boolean>;
  createSession(
    input: Readonly<{
      userId: string;
      tokenDigest: string;
      now: Date;
      idleExpiresAt: Date;
    }>,
  ): Promise<AccountSessionRecord>;
  resolveAndTouchSession(
    input: Readonly<{
      tokenDigest: string;
      now: Date;
      idleExpiresAt: Date;
    }>,
  ): Promise<AccountSessionRecord | null>;
  resolveSessionWithoutTouch(
    input: Readonly<{
      tokenDigest: string;
      now: Date;
    }>,
  ): Promise<AccountSessionRecord | null>;
  rotateSessionAfterReverification(
    input: Readonly<{
      currentTokenDigest: string;
      replacementTokenDigest: string;
      userId: string;
      now: Date;
      idleExpiresAt: Date;
      reverifiedUntil: Date;
    }>,
  ): Promise<AccountSessionRecord | null>;
  revokeSession(tokenDigest: string, now: Date): Promise<void>;
  revokeAllUserSessions(userId: string, now: Date): Promise<void>;
  createEmailVerificationChallenge(
    input: Readonly<{
      userId: string;
      tokenDigest: string;
      now: Date;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  consumeEmailVerificationChallenge(
    input: Readonly<{ tokenDigest: string; now: Date }>,
  ): Promise<{ status: "verified"; userId: string } | { status: "invalid_or_expired" }>;
  createPasswordResetChallenge(
    input: Readonly<{
      userId: string;
      tokenDigest: string;
      now: Date;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  consumePasswordResetChallenge(
    input: Readonly<{
      tokenDigest: string;
      passwordHash: string;
      now: Date;
    }>,
  ): Promise<{ status: "completed"; userId: string } | { status: "invalid_or_expired" }>;
  disableAccountAndRevokeSessions(userId: string, now: Date): Promise<boolean>;
}

export interface PasswordResetDeliveryPort {
  sendEmailVerification(
    input: Readonly<{
      normalizedEmail: string;
      rawToken: string;
      deliveryContextDigest: string;
    }>,
  ): Promise<void>;
  sendPasswordReset(
    input: Readonly<{
      normalizedEmail: string;
      rawToken: string;
      deliveryContextDigest: string;
    }>,
  ): Promise<void>;
}

export interface EnumerationResistancePort {
  complete(startedAt: number): Promise<void>;
}

export interface AuthClockPort {
  now(): Date;
}
