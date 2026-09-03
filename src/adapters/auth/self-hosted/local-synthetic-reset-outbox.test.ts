import { describe, expect, it } from "vitest";
import { LocalSyntheticPasswordResetOutbox } from "./local-synthetic-reset-outbox";

describe("LocalSyntheticPasswordResetOutbox", () => {
  it("binds one-time codes to the pre-auth browser context and normalized Email", async () => {
    const outbox = new LocalSyntheticPasswordResetOutbox();
    const browserA = "a".repeat(64);
    const browserB = "b".repeat(64);
    await outbox.sendEmailVerification({
      normalizedEmail: "demo@example.com",
      rawToken: "V".repeat(43),
      deliveryContextDigest: browserA,
    });
    expect(outbox.consumeLatestVerificationToken("DEMO@example.com", browserB)).toBeNull();
    expect(outbox.consumeLatestVerificationToken("DEMO@example.com", browserA)).toBe(
      "V".repeat(43),
    );
    expect(outbox.consumeLatestVerificationToken("demo@example.com", browserA)).toBeNull();
  });

  it("keeps password-reset and verification channels separate", async () => {
    const outbox = new LocalSyntheticPasswordResetOutbox();
    const context = "c".repeat(64);
    await outbox.sendPasswordReset({
      normalizedEmail: "demo@example.com",
      rawToken: "R".repeat(43),
      deliveryContextDigest: context,
    });
    expect(outbox.consumeLatestVerificationToken("demo@example.com", context)).toBeNull();
    expect(outbox.consumeLatestResetToken("demo@example.com", context)).toBe("R".repeat(43));
  });
});
