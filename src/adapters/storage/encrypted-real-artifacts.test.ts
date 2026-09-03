import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealArtifactReservation } from "@/application/real-demo";
import { EncryptedRealArtifactStore, parseRealDataEncryptionKey } from "./encrypted-real-artifacts";

vi.mock("server-only", () => ({}));

const roots: string[] = [];
const reservation = {
  artifactId: "artifact_abcdefghijklmnopqrstuvwxyz123456",
  caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
  kind: "listing_image",
  mime: "image/png",
  originalSha256: "a".repeat(64),
  originalBytes: 17,
} as const satisfies RealArtifactReservation;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("EncryptedRealArtifactStore", () => {
  it("writes only AES-GCM envelopes and returns generated relative paths", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "rentproof-encrypted-store-"));
    roots.push(root);
    const store = await EncryptedRealArtifactStore.create(root, Buffer.alloc(32, 7));
    const plaintext = new TextEncoder().encode("private lease data");
    const result = await store.save({
      reservation: { ...reservation, originalBytes: plaintext.byteLength },
      originalBytes: plaintext,
      derivative: { bytes: Uint8Array.of(1, 2, 3), sha256: "b".repeat(64) },
      extractedText: "located contract text",
    });
    expect(result).toEqual({
      originalRelativePath: `${reservation.caseId}/${reservation.artifactId}/original.enc`,
      derivativeRelativePath: `${reservation.caseId}/${reservation.artifactId}/derivative.enc`,
      extractedTextRelativePath: `${reservation.caseId}/${reservation.artifactId}/extracted-text.enc`,
      derivativeSha256: "b".repeat(64),
      derivativeBytes: 3,
    });
    const encrypted = await readFile(resolve(root, ...result.originalRelativePath.split("/")));
    expect(encrypted.subarray(0, 19).toString("ascii")).toBe("RENTPROOF-AESGCM-2\0");
    expect(encrypted.includes(Buffer.from(plaintext))).toBe(false);
    await expect(store.read(result.originalRelativePath)).resolves.toSatisfy((value: Uint8Array) =>
      Buffer.from(value).equals(Buffer.from(plaintext)),
    );
  });

  it("binds each authenticated envelope to its relative path", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "rentproof-encrypted-store-"));
    roots.push(root);
    const store = await EncryptedRealArtifactStore.create(root, Buffer.alloc(32, 8));
    const first = await store.save({ reservation, originalBytes: new Uint8Array(17) });
    const secondReservation = {
      ...reservation,
      artifactId: "artifact_zyxwvutsrqponmlkjihgfedcba654321",
      originalSha256: "b".repeat(64),
    };
    const second = await store.save({
      reservation: secondReservation,
      originalBytes: new Uint8Array(17),
    });
    const firstEnvelope = await readFile(resolve(root, ...first.originalRelativePath.split("/")));
    await writeFile(resolve(root, ...second.originalRelativePath.split("/")), firstEnvelope);

    await expect(store.read(second.originalRelativePath)).rejects.toThrow(
      "REAL_DATA_ENVELOPE_INVALID",
    );
  });

  it("removes only the generated case directory", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "rentproof-encrypted-store-"));
    roots.push(root);
    const store = await EncryptedRealArtifactStore.create(root, Buffer.alloc(32, 9));
    await store.save({
      reservation,
      originalBytes: new Uint8Array(reservation.originalBytes),
    });
    await store.deleteCase(reservation.caseId);
    await expect(
      readFile(resolve(root, reservation.caseId, reservation.artifactId, "original.enc")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires an exact 32-byte base64url key", () => {
    expect(parseRealDataEncryptionKey(Buffer.alloc(32, 1).toString("base64url"))).toHaveLength(32);
    expect(() => parseRealDataEncryptionKey(undefined)).toThrow("REAL_DATA_ENCRYPTION_KEY_INVALID");
    expect(() => parseRealDataEncryptionKey("short")).toThrow("REAL_DATA_ENCRYPTION_KEY_INVALID");
  });
});
