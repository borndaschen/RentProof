import { describe, expect, it, vi } from "vitest";
import { ARGON2ID_PARAMETERS, Argon2idPasswordHasher } from "./argon2id-password-hasher";
import { createInstalledArgon2idPasswordHasher } from "./argon2id-password-hasher";

const validHash = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnaWVzdA";

describe("Argon2idPasswordHasher", () => {
  it("pins OWASP-minimum Argon2id parameters through an audited implementation", async () => {
    const api = {
      argon2id: 2,
      hash: vi.fn().mockResolvedValue(validHash),
      verify: vi.fn().mockResolvedValue(true),
      needsRehash: vi.fn().mockReturnValue(false),
    };
    const hasher = new Argon2idPasswordHasher(api);
    await expect(hasher.hash("correct horse battery staple")).resolves.toBe(validHash);
    expect(api.hash).toHaveBeenCalledWith("correct horse battery staple", {
      type: 2,
      ...ARGON2ID_PARAMETERS,
    });
    await expect(hasher.verify(validHash, "correct horse battery staple")).resolves.toBe(true);
    expect(hasher.needsRehash(validHash)).toBe(false);
  });

  it("fails closed for malformed hashes and verification errors", async () => {
    const hasher = new Argon2idPasswordHasher({
      argon2id: 2,
      hash: vi.fn().mockResolvedValue("not-a-phc"),
      verify: vi.fn().mockRejectedValue(new Error("native error")),
    });
    await expect(hasher.hash("correct horse battery staple")).rejects.toThrow(
      "ARGON2ID_HASH_INVALID",
    );
    await expect(hasher.verify("not-a-phc", "secret")).resolves.toBe(false);
    await expect(hasher.verify(validHash, "secret")).resolves.toBe(false);
    expect(hasher.needsRehash("not-a-phc")).toBe(true);
  });

  it("hashes and verifies through the installed audited native package", async () => {
    const hasher = createInstalledArgon2idPasswordHasher();
    const hash = await hasher.hash("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$v=19\$/u);
    expect(hash).toContain("m=19456");
    expect(hash).toContain("t=2");
    expect(hash).toContain("p=1");
    await expect(hasher.verify(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(hasher.verify(hash, "wrong password")).resolves.toBe(false);
  });
});
