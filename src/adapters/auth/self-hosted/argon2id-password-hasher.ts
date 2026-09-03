import * as argon2 from "argon2";
import type { PasswordHasherPort } from "@/application/auth";

export const ARGON2ID_PARAMETERS = Object.freeze({
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

export class PasswordHashError extends Error {
  override readonly name = "PasswordHashError";
}

export type AuditedArgon2Api = Readonly<{
  argon2id: number;
  hash(
    password: string,
    options: Readonly<{
      type: number;
      memoryCost: number;
      timeCost: number;
      parallelism: number;
      hashLength: number;
    }>,
  ): Promise<string>;
  verify(
    passwordHash: string,
    password: string,
    options: Readonly<{ type: number }>,
  ): Promise<boolean>;
  needsRehash?(
    passwordHash: string,
    options: Readonly<{
      memoryCost: number;
      timeCost: number;
      parallelism: number;
      hashLength: number;
    }>,
  ): boolean;
}>;

export class Argon2idPasswordHasher implements PasswordHasherPort {
  constructor(private readonly argon2: AuditedArgon2Api) {}

  async hash(password: string): Promise<string> {
    try {
      const passwordHash = await this.argon2.hash(password, {
        type: this.argon2.argon2id,
        ...ARGON2ID_PARAMETERS,
      });
      if (!isArgon2idHash(passwordHash)) throw new PasswordHashError("ARGON2ID_HASH_INVALID");
      return passwordHash;
    } catch (error: unknown) {
      if (error instanceof PasswordHashError) throw error;
      throw new PasswordHashError("ARGON2ID_HASH_FAILED");
    }
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    if (!isArgon2idHash(passwordHash)) return false;
    try {
      return await this.argon2.verify(passwordHash, password, { type: this.argon2.argon2id });
    } catch {
      return false;
    }
  }

  needsRehash(passwordHash: string): boolean {
    if (!isArgon2idHash(passwordHash)) return true;
    if (this.argon2.needsRehash) {
      return this.argon2.needsRehash(passwordHash, ARGON2ID_PARAMETERS);
    }
    const parameters = parseArgon2idParameters(passwordHash);
    return (
      !parameters ||
      parameters.memoryCost < ARGON2ID_PARAMETERS.memoryCost ||
      parameters.timeCost < ARGON2ID_PARAMETERS.timeCost ||
      parameters.parallelism < ARGON2ID_PARAMETERS.parallelism
    );
  }
}

export function createInstalledArgon2idPasswordHasher(): Argon2idPasswordHasher {
  return new Argon2idPasswordHasher({
    argon2id: argon2.argon2id,
    hash: (password, options) =>
      argon2.hash(password, { ...options, type: argon2.argon2id, raw: false }),
    verify: (passwordHash, password) => argon2.verify(passwordHash, password),
    needsRehash: (passwordHash, options) => argon2.needsRehash(passwordHash, options),
  });
}

function isArgon2idHash(value: string): boolean {
  return (
    parseArgon2idParameters(value) !== null &&
    /^\$argon2id\$v=19\$[^$]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u.test(value)
  );
}

function parseArgon2idParameters(value: string): {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
} | null {
  const parameterSection = value.split("$")[3];
  if (!parameterSection) return null;
  const values = new Map<string, number>();
  for (const entry of parameterSection.split(",")) {
    const match = /^(m|t|p)=(\d+)$/u.exec(entry);
    if (!match) return null;
    const key = match[1];
    const rawValue = match[2];
    if (!key || !rawValue || values.has(key)) return null;
    values.set(key, Number(rawValue));
  }
  const memoryCost = values.get("m");
  const timeCost = values.get("t");
  const parallelism = values.get("p");
  return values.size === 3 && memoryCost && timeCost && parallelism
    ? { memoryCost, timeCost, parallelism }
    : null;
}
