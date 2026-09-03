import { z } from "zod";

export const ACCOUNT_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1_000;
export const ACCOUNT_REVERIFICATION_MS = 15 * 60 * 1_000;
export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1_000;

export const NormalizedEmailSchema = z
  .string()
  .min(3)
  .max(254)
  .email()
  .regex(/^[\x20-\x7E]+$/u);

export const AccountPasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine((value) => !value.includes("\0"), "PASSWORD_INVALID");

export const OpaqueAccountTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const TokenDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export function normalizeEmailIdentifier(input: string): string {
  const normalized = input.trim().normalize("NFC").toLowerCase();
  return NormalizedEmailSchema.parse(normalized);
}

export type AccountCredential = Readonly<{
  userId: string;
  normalizedEmail: string;
  passwordHash: string;
  emailVerified: boolean;
  status: "active" | "disabled" | "deletion_pending";
}>;

export type AccountSessionRecord = Readonly<{
  sessionId: string;
  userId: string;
  idleExpiresAt: Date;
  reverifiedUntil: Date | null;
}>;

export type IssuedOpaqueToken = Readonly<{
  rawToken: string;
  digest: string;
}>;

export type AccountSessionCookie = Readonly<{
  token: string;
  maxAgeSeconds: number;
}>;
