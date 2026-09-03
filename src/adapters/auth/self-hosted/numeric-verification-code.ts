import { createHmac, randomInt } from "node:crypto";

const CODE_LENGTH = 6;
const CODE_LIMIT = 1_000_000;
const DOMAIN = "RentProof/auth/numeric-verification-code/v1\0";

export interface NumericVerificationCodeIssue {
  readonly rawToken: string;
  readonly digest: string;
}

/** Issues and validates the digest of a six-digit, zero-padded verification code. */
export class HmacNumericVerificationCodeService {
  readonly #key: Uint8Array;

  constructor(key: Uint8Array) {
    if (key.byteLength < 32) throw new Error("AUTH_VERIFICATION_KEY_TOO_SHORT");
    this.#key = new Uint8Array(key);
  }

  issue(): NumericVerificationCodeIssue {
    const rawToken = randomInt(CODE_LIMIT).toString(10).padStart(CODE_LENGTH, "0");
    return { rawToken, digest: this.#digestValidated(rawToken) };
  }

  digest(rawToken: string): string | null {
    return /^\d{6}$/u.test(rawToken) ? this.#digestValidated(rawToken) : null;
  }

  #digestValidated(rawToken: string): string {
    return createHmac("sha256", this.#key)
      .update(DOMAIN, "ascii")
      .update(rawToken, "ascii")
      .digest("hex");
  }
}

/** Backwards-compatible descriptive alias. */
export { HmacNumericVerificationCodeService as NumericVerificationCodeService };
