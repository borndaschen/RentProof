import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, win32 } from "node:path";
import {
  SafeRelativeStoragePathSchema,
  RealArtifactReservationSchema,
  type EncryptedRealArtifactStorePort,
  type RealArtifactReservation,
  type StoredArtifactPaths,
} from "@/application/real-demo";
import type { PreparedArtifactWriter } from "@/application/processing/contracts";

const FILE_MAGIC = Buffer.from("RENTPROOF-AESGCM-2\0", "ascii");

export function parseRealDataEncryptionKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new Error("REAL_DATA_ENCRYPTION_KEY_INVALID");
  }
  const key = Buffer.from(value, "base64url");
  if (key.byteLength !== 32) throw new Error("REAL_DATA_ENCRYPTION_KEY_INVALID");
  return key;
}

export class EncryptedRealArtifactStore
  implements EncryptedRealArtifactStorePort, PreparedArtifactWriter
{
  private constructor(
    private readonly root: string,
    private readonly key: Buffer,
  ) {}

  static async create(root: string, key: Buffer): Promise<EncryptedRealArtifactStore> {
    if (
      !isAbsolute(root) ||
      !win32.isAbsolute(root) ||
      root.startsWith("\\\\") ||
      root.includes("\0") ||
      key.byteLength !== 32
    ) {
      throw new Error("REAL_DATA_STORAGE_ROOT_INVALID");
    }
    const resolved = await realpath(root);
    const stat = await lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("REAL_DATA_STORAGE_ROOT_INVALID");
    }
    return new EncryptedRealArtifactStore(resolved, Buffer.from(key));
  }

  async save(input: {
    reservation: RealArtifactReservation;
    originalBytes: Uint8Array;
    derivative?: Readonly<{ bytes: Uint8Array; sha256: string }>;
    extractedText?: string;
  }): Promise<StoredArtifactPaths> {
    const caseDirectory = resolve(this.root, input.reservation.caseId);
    await mkdir(caseDirectory, { recursive: true });
    await this.assertContainedDirectory(caseDirectory);
    const directory = this.artifactPath(input.reservation);
    await mkdir(directory, { recursive: false });
    await this.assertContainedDirectory(directory);
    const originalRelativePath = relativePath(input.reservation, "original.enc");
    await this.writeEncrypted(
      resolve(this.root, ...originalRelativePath.split("/")),
      originalRelativePath,
      input.originalBytes,
    );

    let derivativeRelativePath: string | null = null;
    let derivativeBytes: number | null = null;
    if (input.derivative) {
      derivativeRelativePath = relativePath(input.reservation, "derivative.enc");
      derivativeBytes = input.derivative.bytes.byteLength;
      await this.writeEncrypted(
        resolve(this.root, ...derivativeRelativePath.split("/")),
        derivativeRelativePath,
        input.derivative.bytes,
      );
    }

    let extractedTextRelativePath: string | null = null;
    if (input.extractedText !== undefined) {
      extractedTextRelativePath = relativePath(input.reservation, "extracted-text.enc");
      await this.writeEncrypted(
        resolve(this.root, ...extractedTextRelativePath.split("/")),
        extractedTextRelativePath,
        new TextEncoder().encode(input.extractedText.normalize("NFC")),
      );
    }

    return {
      originalRelativePath,
      derivativeRelativePath,
      extractedTextRelativePath,
      derivativeSha256: input.derivative?.sha256 ?? null,
      derivativeBytes,
    };
  }

  async deleteArtifact(reservation: RealArtifactReservation): Promise<void> {
    const directory = this.artifactPath(reservation);
    await this.removeOwnedDirectory(directory, reservation.caseId);
  }

  async deleteCase(caseId: string): Promise<void> {
    const directory = resolve(this.root, caseId);
    await this.removeOwnedDirectory(directory, caseId);
  }

  async read(relativePathValue: string): Promise<Uint8Array> {
    const relativePath = SafeRelativeStoragePathSchema.parse(relativePathValue);
    const path = resolve(this.root, ...relativePath.split("/"));
    const resolved = await realpath(path);
    const rel = relative(this.root, resolved);
    const stat = await lstat(resolved);
    if (
      !rel ||
      resolved.toLowerCase() !== path.toLowerCase() ||
      rel.startsWith("..") ||
      win32.isAbsolute(rel) ||
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > 50 * 1024 * 1024 + FILE_MAGIC.byteLength + 28
    ) {
      throw new Error("REAL_DATA_STORAGE_PATH_INVALID");
    }
    const payload = await readFile(resolved);
    const headerBytes = FILE_MAGIC.byteLength + 12 + 16;
    if (
      payload.byteLength <= headerBytes ||
      !payload.subarray(0, FILE_MAGIC.byteLength).equals(FILE_MAGIC)
    ) {
      throw new Error("REAL_DATA_ENVELOPE_INVALID");
    }
    const nonceStart = FILE_MAGIC.byteLength;
    const tagStart = nonceStart + 12;
    const ciphertextStart = tagStart + 16;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      payload.subarray(nonceStart, tagStart),
    );
    decipher.setAAD(Buffer.from(relativePath, "utf8"));
    decipher.setAuthTag(payload.subarray(tagStart, ciphertextStart));
    try {
      return Uint8Array.from(
        Buffer.concat([decipher.update(payload.subarray(ciphertextStart)), decipher.final()]),
      );
    } catch {
      throw new Error("REAL_DATA_ENVELOPE_INVALID");
    }
  }

  private artifactPath(reservation: RealArtifactReservation): string {
    return resolve(this.root, reservation.caseId, reservation.artifactId);
  }

  async writePrepared(
    input: Parameters<PreparedArtifactWriter["writePrepared"]>[0],
  ): Promise<StoredArtifactPaths> {
    const reservation = RealArtifactReservationSchema.parse(input.reservation);
    const directory = this.artifactPath(reservation);
    await this.assertContainedDirectory(directory);
    if (
      (input.derivative?.bytes.byteLength ?? 0) > 25 * 1024 * 1024 ||
      (input.extractedText !== undefined &&
        Buffer.byteLength(input.extractedText) > 4 * 1024 * 1024)
    ) {
      throw new Error("REAL_DATA_STORAGE_PAYLOAD_TOO_LARGE");
    }
    if (
      input.derivative &&
      (input.derivative.bytes.byteLength === 0 ||
        createHash("sha256").update(input.derivative.bytes).digest("hex") !==
          input.derivative.sha256)
    ) {
      throw new Error("REAL_DATA_STORAGE_HASH_INVALID");
    }
    const originalRelativePath = relativePath(reservation, "original.enc");
    const derivativeRelativePath = input.derivative
      ? relativePath(reservation, "derivative.enc")
      : null;
    const extractedTextRelativePath =
      input.extractedText === undefined ? null : relativePath(reservation, "extracted-text.enc");
    if (input.derivative && derivativeRelativePath) {
      await this.writeEncrypted(
        resolve(this.root, ...derivativeRelativePath.split("/")),
        derivativeRelativePath,
        input.derivative.bytes,
      );
    }
    if (input.extractedText !== undefined && extractedTextRelativePath) {
      await this.writeEncrypted(
        resolve(this.root, ...extractedTextRelativePath.split("/")),
        extractedTextRelativePath,
        new TextEncoder().encode(input.extractedText),
      );
    }
    return {
      originalRelativePath,
      derivativeRelativePath,
      extractedTextRelativePath,
      derivativeSha256: input.derivative?.sha256 ?? null,
      derivativeBytes: input.derivative?.bytes.byteLength ?? null,
    };
  }

  private async writeEncrypted(
    path: string,
    relativePath: string,
    plaintext: Uint8Array,
  ): Promise<void> {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(relativePath, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([FILE_MAGIC, nonce, tag, ciphertext]);
    const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async assertContainedDirectory(directory: string): Promise<void> {
    const resolved = await realpath(directory);
    const rel = relative(this.root, resolved);
    const stat = await lstat(resolved);
    if (
      !rel ||
      resolved.toLowerCase() !== directory.toLowerCase() ||
      rel.startsWith("..") ||
      win32.isAbsolute(rel) ||
      stat.isSymbolicLink()
    ) {
      throw new Error("REAL_DATA_STORAGE_PATH_INVALID");
    }
  }

  private async removeOwnedDirectory(directory: string, requiredSegment: string): Promise<void> {
    let resolved: string;
    try {
      resolved = await realpath(directory);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return;
      throw error;
    }
    const rel = relative(this.root, resolved);
    const stat = await lstat(resolved);
    if (
      !rel ||
      resolved.toLowerCase() !== directory.toLowerCase() ||
      rel.startsWith("..") ||
      win32.isAbsolute(rel) ||
      !rel.split(/[\\/]/u).includes(requiredSegment) ||
      stat.isSymbolicLink() ||
      !stat.isDirectory()
    ) {
      throw new Error("REAL_DATA_STORAGE_PATH_INVALID");
    }
    await rm(resolved, { recursive: true, force: false });
  }
}

function relativePath(reservation: RealArtifactReservation, name: string): string {
  return `${reservation.caseId}/${reservation.artifactId}/${name}`;
}

function nodeErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = Reflect.get(error, "code") as unknown;
  return typeof code === "string" ? code : null;
}
