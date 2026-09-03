import { createHmac, randomBytes } from "node:crypto";
import type { OpaqueTokenPort } from "@/application/auth";
import { OpaqueAccountTokenSchema } from "@/application/auth";

export class HmacOpaqueTokenService implements OpaqueTokenPort {
  readonly #key: Uint8Array;

  constructor(key: Uint8Array) {
    if (key.byteLength < 32) throw new Error("AUTH_TOKEN_KEY_TOO_SHORT");
    this.#key = new Uint8Array(key);
  }

  issue() {
    const rawToken = randomBytes(32).toString("base64url");
    return { rawToken, digest: this.#digestValidated(rawToken) };
  }

  digest(rawToken: string): string | null {
    const parsed = OpaqueAccountTokenSchema.safeParse(rawToken);
    return parsed.success ? this.#digestValidated(parsed.data) : null;
  }

  #digestValidated(rawToken: string): string {
    return createHmac("sha256", this.#key).update(rawToken, "ascii").digest("hex");
  }
}

export function parseAccountTokenKey(encoded: string | undefined): Uint8Array {
  if (!encoded || !/^[A-Za-z0-9_-]{43,}$/u.test(encoded)) {
    throw new Error("AUTH_TOKEN_KEY_INVALID");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.byteLength < 32) throw new Error("AUTH_TOKEN_KEY_TOO_SHORT");
  return new Uint8Array(key);
}
