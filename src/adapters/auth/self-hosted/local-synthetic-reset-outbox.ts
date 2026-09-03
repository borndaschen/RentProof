import { normalizeEmailIdentifier, type PasswordResetDeliveryPort } from "@/application/auth";

/** Loopback-only adapter. It must never be composed in LAN or production profiles. */
export class LocalSyntheticPasswordResetOutbox implements PasswordResetDeliveryPort {
  readonly #resetTokens = new Map<string, string>();
  readonly #verificationTokens = new Map<string, string>();

  async sendEmailVerification(
    input: Readonly<{
      normalizedEmail: string;
      rawToken: string;
      deliveryContextDigest: string;
    }>,
  ): Promise<void> {
    this.#verificationTokens.set(
      this.#key(input.normalizedEmail, input.deliveryContextDigest),
      input.rawToken,
    );
  }

  async sendPasswordReset(
    input: Readonly<{
      normalizedEmail: string;
      rawToken: string;
      deliveryContextDigest: string;
    }>,
  ): Promise<void> {
    this.#resetTokens.set(
      this.#key(input.normalizedEmail, input.deliveryContextDigest),
      input.rawToken,
    );
  }

  consumeLatestResetToken(email: string, deliveryContextDigest: string): string | null {
    return this.#consume(this.#resetTokens, email, deliveryContextDigest);
  }

  consumeLatestVerificationToken(email: string, deliveryContextDigest: string): string | null {
    return this.#consume(this.#verificationTokens, email, deliveryContextDigest);
  }

  #consume(
    tokens: Map<string, string>,
    email: string,
    deliveryContextDigest: string,
  ): string | null {
    let key: string;
    try {
      key = this.#key(email, deliveryContextDigest);
    } catch {
      return null;
    }
    const rawToken = tokens.get(key) ?? null;
    tokens.delete(key);
    return rawToken;
  }

  #key(email: string, deliveryContextDigest: string): string {
    if (!/^[a-f0-9]{64}$/u.test(deliveryContextDigest)) {
      throw new Error("DELIVERY_CONTEXT_INVALID");
    }
    return `${deliveryContextDigest}:${normalizeEmailIdentifier(email)}`;
  }
}
