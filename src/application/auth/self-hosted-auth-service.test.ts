import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EnumerationResistancePort,
  OpaqueTokenPort,
  PasswordHasherPort,
  PasswordResetDeliveryPort,
  SelfHostedAuthRepositoryPort,
  VerificationCodePort,
} from "./self-hosted-ports";
import { SelfHostedAuthService } from "./self-hosted-auth-service";

const now = new Date("2026-09-03T00:00:00.000Z");
const validRawToken = "A".repeat(43);
const validVerificationCode = "123456";
const validDigest = "a".repeat(64);
const deliveryContextDigest = "b".repeat(64);
const passwordHash = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnaWVzdA";
const userId = "user_abcdefghijklmnopqrst";

describe("SelfHostedAuthService", () => {
  let repository: SelfHostedAuthRepositoryPort;
  let passwords: PasswordHasherPort;
  let tokens: OpaqueTokenPort;
  let verificationCodes: VerificationCodePort;
  let delivery: PasswordResetDeliveryPort;
  let responseFloor: EnumerationResistancePort;

  beforeEach(() => {
    repository = {
      createAccount: vi.fn().mockResolvedValue({ status: "created", userId }),
      findCredentialByEmail: vi.fn().mockResolvedValue(null),
      findCredentialByUserId: vi.fn().mockResolvedValue(null),
      replacePasswordHash: vi.fn().mockResolvedValue(true),
      createSession: vi.fn().mockResolvedValue({
        sessionId: "session_abcdefghijklmnopq",
        userId,
        idleExpiresAt: new Date(now.getTime() + 604_800_000),
        reverifiedUntil: null,
      }),
      resolveAndTouchSession: vi.fn().mockResolvedValue(null),
      resolveSessionWithoutTouch: vi.fn().mockResolvedValue(null),
      rotateSessionAfterReverification: vi.fn().mockResolvedValue({
        sessionId: "session_replacementabcdef",
        userId,
        idleExpiresAt: new Date(now.getTime() + 604_800_000),
        reverifiedUntil: new Date(now.getTime() + 900_000),
      }),
      revokeSession: vi.fn().mockResolvedValue(undefined),
      revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
      createEmailVerificationChallenge: vi.fn().mockResolvedValue(undefined),
      consumeEmailVerificationChallenge: vi
        .fn()
        .mockResolvedValue({ status: "invalid_or_expired" }),
      createPasswordResetChallenge: vi.fn().mockResolvedValue(undefined),
      consumePasswordResetChallenge: vi.fn().mockResolvedValue({ status: "invalid_or_expired" }),
      disableAccountAndRevokeSessions: vi.fn().mockResolvedValue(true),
    };
    passwords = {
      hash: vi.fn().mockResolvedValue(passwordHash),
      verify: vi.fn().mockResolvedValue(false),
      needsRehash: vi.fn().mockReturnValue(false),
    };
    tokens = {
      issue: vi.fn().mockReturnValue({ rawToken: validRawToken, digest: validDigest }),
      digest: vi
        .fn()
        .mockImplementation((value: string) => (value === validRawToken ? validDigest : null)),
    };
    verificationCodes = {
      issue: vi.fn().mockReturnValue({ rawToken: validVerificationCode, digest: validDigest }),
      digest: vi
        .fn()
        .mockImplementation((value: string) =>
          value === validVerificationCode ? validDigest : null,
        ),
    };
    delivery = {
      sendEmailVerification: vi.fn().mockResolvedValue(undefined),
      sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    };
    responseFloor = { complete: vi.fn().mockResolvedValue(undefined) };
  });

  function service() {
    return new SelfHostedAuthService(
      repository,
      passwords,
      tokens,
      verificationCodes,
      delivery,
      { now: () => now },
      passwordHash,
      responseFloor,
    );
  }

  it("normalizes registration identifiers and gives duplicate and new accounts the same response", async () => {
    vi.mocked(repository.findCredentialByUserId).mockResolvedValue({
      userId,
      normalizedEmail: "demo.user@example.com",
      passwordHash,
      emailVerified: false,
      status: "active",
    });
    await expect(
      service().register({
        email: "  Demo.User@Example.COM ",
        password: "correct horse battery",
        deliveryContextDigest,
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(repository.createAccount).toHaveBeenCalledWith({
      normalizedEmail: "demo.user@example.com",
      passwordHash,
      now,
    });
    expect(delivery.sendEmailVerification).toHaveBeenCalledWith({
      normalizedEmail: "demo.user@example.com",
      rawToken: validVerificationCode,
      deliveryContextDigest,
    });
  });

  it.each([
    "INPUT_NORMALIZATION",
    "PASSWORD_HASH",
    "ACCOUNT_CREATE",
    "CREDENTIAL_LOOKUP",
    "CHALLENGE_CREATE",
    "DELIVERY",
  ] as const)("wraps registration failure as safe typed phase %s", async (phase) => {
    const input = {
      email: phase === "INPUT_NORMALIZATION" ? "not-an-email" : "demo@example.com",
      password: "correct horse battery",
      deliveryContextDigest,
    };
    if (phase === "PASSWORD_HASH") vi.mocked(passwords.hash).mockRejectedValue(new Error("raw"));
    if (phase === "ACCOUNT_CREATE") {
      vi.mocked(repository.createAccount).mockRejectedValue(new Error("raw"));
    }
    if (phase === "CREDENTIAL_LOOKUP") {
      vi.mocked(repository.findCredentialByUserId).mockRejectedValue(new Error("raw"));
    }
    if (phase === "CHALLENGE_CREATE" || phase === "DELIVERY") {
      vi.mocked(repository.findCredentialByUserId).mockResolvedValue({
        userId,
        normalizedEmail: "demo@example.com",
        passwordHash,
        emailVerified: false,
        status: "active",
      });
    }
    if (phase === "CHALLENGE_CREATE") {
      vi.mocked(repository.createEmailVerificationChallenge).mockRejectedValue(new Error("raw"));
    }
    if (phase === "DELIVERY") {
      vi.mocked(delivery.sendEmailVerification).mockRejectedValue(new Error("raw"));
    }

    await expect(service().register(input)).rejects.toMatchObject({
      name: "AuthRegistrationError",
      code: phase,
      message: phase,
    });
    expect(responseFloor.complete).toHaveBeenCalledOnce();
  });

  it("reports response-floor failure without leaking or retaining an earlier cause", async () => {
    vi.mocked(passwords.hash).mockRejectedValue(new Error("native secret detail"));
    vi.mocked(responseFloor.complete).mockRejectedValue(new Error("timer detail"));
    await expect(
      service().register({
        email: "demo@example.com",
        password: "correct horse battery",
        deliveryContextDigest,
      }),
    ).rejects.toMatchObject({
      name: "AuthRegistrationError",
      code: "RESPONSE_FLOOR",
      message: "RESPONSE_FLOOR",
    });
  });

  it.each([
    ["42501", "POSTGRES_INSUFFICIENT_PRIVILEGE"],
    ["23502", "POSTGRES_NOT_NULL_VIOLATION"],
    ["23503", "POSTGRES_FOREIGN_KEY_VIOLATION"],
    ["23505", "POSTGRES_UNIQUE_VIOLATION"],
    ["23514", "POSTGRES_CHECK_VIOLATION"],
    ["42P01", "POSTGRES_UNDEFINED_TABLE"],
    ["42703", "POSTGRES_UNDEFINED_COLUMN"],
    ["XX000", "POSTGRES_OTHER"],
  ] as const)(
    "derives allowlisted account-create detail only from SQLSTATE %s",
    async (code, detail) => {
      vi.mocked(repository.createAccount).mockRejectedValue(
        Object.assign(new Error("private SQL and values"), { code }),
      );
      let caught: unknown;
      try {
        await service().register({
          email: "demo@example.com",
          password: "correct horse battery",
          deliveryContextDigest,
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toMatchObject({
        name: "AuthRegistrationError",
        code: "ACCOUNT_CREATE",
        detail,
        message: "ACCOUNT_CREATE",
      });
      expect(caught).not.toHaveProperty("cause");
      expect(JSON.stringify(caught)).not.toMatch(/private|demo@example|correct horse/iu);
    },
  );

  it("does not inspect throwing SQLSTATE accessors or invent a database detail", async () => {
    vi.mocked(repository.createAccount).mockRejectedValue(
      Object.create(null, {
        code: {
          get: () => {
            throw new Error("private getter detail");
          },
        },
      }),
    );
    await expect(
      service().register({
        email: "demo@example.com",
        password: "correct horse battery",
        deliveryContextDigest,
      }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_CREATE",
      detail: undefined,
    });
  });

  it("performs dummy verification for unknown or malformed identifiers", async () => {
    await expect(
      service().authenticate({ email: "missing@example.com", password: "wrong password" }),
    ).resolves.toEqual({ status: "invalid_credentials" });
    await expect(
      service().authenticate({ email: "not-an-email", password: "wrong password" }),
    ).resolves.toEqual({ status: "invalid_credentials" });
    expect(passwords.verify).toHaveBeenCalledTimes(2);
    expect(passwords.verify).toHaveBeenCalledWith(passwordHash, "wrong password");
    expect(passwords.verify).toHaveBeenCalledWith(passwordHash, "invalid-auth-input");
  });

  it.each(["short", `valid-prefix\0secret`, "x".repeat(129)])(
    "never sends invalid or oversized password input to Argon2: %s",
    async (attackerPassword) => {
      await expect(
        service().authenticate({ email: "demo@example.com", password: attackerPassword }),
      ).resolves.toEqual({ status: "invalid_credentials" });
      expect(passwords.verify).toHaveBeenCalledWith(passwordHash, "invalid-auth-input");
      expect(passwords.verify).not.toHaveBeenCalledWith(passwordHash, attackerPassword);
    },
  );

  it("blocks login until the single-use Email verification challenge is consumed", async () => {
    vi.mocked(repository.findCredentialByEmail).mockResolvedValue({
      userId,
      normalizedEmail: "demo@example.com",
      passwordHash,
      emailVerified: false,
      status: "active",
    });
    vi.mocked(passwords.verify).mockResolvedValue(true);
    await expect(
      service().authenticate({ email: "demo@example.com", password: "correct horse battery" }),
    ).resolves.toEqual({ status: "invalid_credentials" });
    expect(repository.createSession).not.toHaveBeenCalled();

    vi.mocked(repository.consumeEmailVerificationChallenge).mockResolvedValue({
      status: "verified",
      userId,
    });
    await expect(service().verifyEmail(validVerificationCode)).resolves.toEqual({
      status: "verified",
    });
    expect(repository.consumeEmailVerificationChallenge).toHaveBeenCalledWith({
      tokenDigest: validDigest,
      now,
    });
  });

  it("creates a fresh session after valid authentication and never accepts a supplied token", async () => {
    vi.mocked(repository.findCredentialByEmail).mockResolvedValue({
      userId,
      normalizedEmail: "demo@example.com",
      passwordHash,
      emailVerified: true,
      status: "active",
    });
    vi.mocked(passwords.verify).mockResolvedValue(true);
    await expect(
      service().authenticate({ email: "demo@example.com", password: "correct horse battery" }),
    ).resolves.toMatchObject({
      status: "authenticated",
      actor: { kind: "user", userId, sessionId: "session_abcdefghijklmnopq" },
      cookie: { token: validRawToken, maxAgeSeconds: 604_800 },
    });
    expect(tokens.issue).toHaveBeenCalledOnce();
    expect(repository.createSession).toHaveBeenCalledWith({
      userId,
      tokenDigest: validDigest,
      now,
      idleExpiresAt: new Date("2026-09-10T00:00:00.000Z"),
      reverifiedUntil: new Date("2026-09-03T00:15:00.000Z"),
    });
  });

  it("atomically requests a seven-day sliding touch on every valid resolution", async () => {
    vi.mocked(repository.resolveAndTouchSession).mockResolvedValue({
      sessionId: "session_abcdefghijklmnopq",
      userId,
      idleExpiresAt: new Date("2026-09-10T00:00:00.000Z"),
      reverifiedUntil: new Date("2026-09-03T00:10:00.000Z"),
    });
    await expect(service().resolveSession(validRawToken, true)).resolves.toEqual({
      status: "authenticated",
      actor: { kind: "user", userId, sessionId: "session_abcdefghijklmnopq" },
      reverified: true,
      refreshCookie: { token: validRawToken, maxAgeSeconds: 604_800 },
    });
    expect(repository.resolveAndTouchSession).toHaveBeenCalledWith({
      tokenDigest: validDigest,
      now,
      idleExpiresAt: new Date("2026-09-10T00:00:00.000Z"),
    });
    await expect(service().resolveSession("invalid")).resolves.toEqual({ status: "signed_out" });
  });

  it("does not slide the session for passive status checks", async () => {
    vi.mocked(repository.resolveSessionWithoutTouch).mockResolvedValue({
      sessionId: "session_abcdefghijklmnopq",
      userId,
      idleExpiresAt: new Date("2026-09-10T00:00:00.000Z"),
      reverifiedUntil: null,
    });
    await expect(service().resolveSession(validRawToken)).resolves.toMatchObject({
      status: "authenticated",
    });
    expect(repository.resolveSessionWithoutTouch).toHaveBeenCalledWith({
      tokenDigest: validDigest,
      now,
    });
    expect(repository.resolveAndTouchSession).not.toHaveBeenCalled();
  });

  it("keeps an actively used session alive beyond seven calendar days while an idle session expires", async () => {
    let current = new Date("2026-09-03T00:00:00.000Z");
    let storedExpiry = new Date("2026-09-10T00:00:00.000Z");
    vi.mocked(repository.resolveAndTouchSession).mockImplementation(async (input) => {
      if (input.now >= storedExpiry) return null;
      storedExpiry = input.idleExpiresAt;
      return {
        sessionId: "session_abcdefghijklmnopq",
        userId,
        idleExpiresAt: storedExpiry,
        reverifiedUntil: null,
      };
    });
    vi.mocked(repository.resolveSessionWithoutTouch).mockImplementation(async (input) =>
      input.now < storedExpiry
        ? {
            sessionId: "session_abcdefghijklmnopq",
            userId,
            idleExpiresAt: storedExpiry,
            reverifiedUntil: null,
          }
        : null,
    );
    const sliding = new SelfHostedAuthService(
      repository,
      passwords,
      tokens,
      verificationCodes,
      delivery,
      { now: () => current },
      passwordHash,
      { complete: vi.fn().mockResolvedValue(undefined) },
    );
    current = new Date("2026-09-09T00:00:00.000Z");
    await expect(sliding.resolveSession(validRawToken, true)).resolves.toMatchObject({
      status: "authenticated",
      refreshCookie: { maxAgeSeconds: 604_800 },
    });
    current = new Date("2026-09-15T00:00:00.000Z");
    await expect(sliding.resolveSession(validRawToken, true)).resolves.toMatchObject({
      status: "authenticated",
    });
    current = new Date("2026-09-23T00:00:00.000Z");
    await expect(sliding.resolveSession(validRawToken)).resolves.toEqual({ status: "signed_out" });
  });

  it("revokes on logout and requires password re-verification for sensitive operations", async () => {
    vi.mocked(repository.resolveAndTouchSession).mockResolvedValue({
      sessionId: "session_abcdefghijklmnopq",
      userId,
      idleExpiresAt: new Date("2026-09-10T00:00:00.000Z"),
      reverifiedUntil: null,
    });
    vi.mocked(repository.findCredentialByUserId).mockResolvedValue({
      userId,
      normalizedEmail: "demo@example.com",
      passwordHash,
      emailVerified: true,
      status: "active",
    });
    vi.mocked(passwords.verify).mockResolvedValue(true);
    await expect(
      service().reverify({ rawToken: validRawToken, password: "correct horse battery" }),
    ).resolves.toEqual({
      status: "reverified",
      cookie: { token: validRawToken, maxAgeSeconds: 604_800 },
    });
    expect(repository.rotateSessionAfterReverification).toHaveBeenCalledWith({
      currentTokenDigest: validDigest,
      replacementTokenDigest: validDigest,
      userId,
      now,
      idleExpiresAt: new Date("2026-09-10T00:00:00.000Z"),
      reverifiedUntil: new Date("2026-09-03T00:15:00.000Z"),
    });
    await service().logout(validRawToken);
    expect(repository.revokeSession).toHaveBeenCalledWith(validDigest, now);
  });

  it("keeps reset request enumeration-safe and consumes a reset only once in the repository", async () => {
    await expect(
      service().requestPasswordReset({ email: "absent@example.com", deliveryContextDigest }),
    ).resolves.toEqual({
      status: "accepted",
    });
    expect(delivery.sendPasswordReset).not.toHaveBeenCalled();
    vi.mocked(repository.findCredentialByEmail).mockResolvedValue({
      userId,
      normalizedEmail: "demo@example.com",
      passwordHash,
      emailVerified: true,
      status: "active",
    });
    await expect(
      service().requestPasswordReset({ email: "DEMO@example.com", deliveryContextDigest }),
    ).resolves.toEqual({
      status: "accepted",
    });
    expect(repository.createPasswordResetChallenge).toHaveBeenCalledWith({
      userId,
      tokenDigest: validDigest,
      now,
      expiresAt: new Date("2026-09-03T00:15:00.000Z"),
    });
    expect(delivery.sendPasswordReset).toHaveBeenCalledWith({
      normalizedEmail: "demo@example.com",
      rawToken: validVerificationCode,
      deliveryContextDigest,
    });

    vi.mocked(repository.consumePasswordResetChallenge).mockResolvedValue({
      status: "completed",
      userId,
    });
    await expect(
      service().completePasswordReset({
        rawToken: validVerificationCode,
        newPassword: "new correct horse battery",
      }),
    ).resolves.toEqual({ status: "completed" });
    expect(repository.consumePasswordResetChallenge).toHaveBeenCalledWith({
      tokenDigest: validDigest,
      passwordHash,
      now,
    });
  });

  it("disables an account and all sessions through one repository transaction", async () => {
    await expect(service().disableAccount(userId)).resolves.toBe(true);
    expect(repository.disableAccountAndRevokeSessions).toHaveBeenCalledWith(userId, now);
  });
});
