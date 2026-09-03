import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import type { DemoManifest, DemoManifestFile } from "@/domain/demo";
import { windowsPathCollisionKey } from "@/domain/demo";
import { DemoManifestVerificationError } from "./errors";

const MANIFEST_CONTROL_FILES = new Set(["manifest.json", "manifest.sha256"]);

function isContainedPath(root: string, candidate: string): boolean {
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  return normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

async function listRelativeFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_UNSAFE");
    }
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_UNSAFE");
    }
  }

  return files;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    if (typeof chunk === "string") {
      throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_UNSAFE");
    }
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function verifyListedFile(caseRoot: string, file: DemoManifestFile): Promise<void> {
  const absolutePath = resolve(caseRoot, ...file.path.split("/"));
  let metadata;
  try {
    metadata = await lstat(absolutePath);
  } catch {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_MISSING");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_UNSAFE");
  }

  const resolvedPath = await realpath(absolutePath);
  if (!isContainedPath(caseRoot, resolvedPath)) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_UNSAFE");
  }
  if (metadata.size !== file.bytes) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_SIZE_MISMATCH");
  }
  if ((await hashFile(resolvedPath)) !== file.sha256) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_HASH_MISMATCH");
  }
}

export interface RuntimeManifestVerification {
  manifest: DemoManifest;
  verifiedFileCount: number;
}

/**
 * Runtime verification treats every listed file, including truth files, as opaque bytes.
 * It validates inventory metadata and hashes and never parses assertions or fallback content.
 */
export async function verifyRuntimeManifestFiles(
  caseRootInput: string,
  manifest: DemoManifest,
): Promise<RuntimeManifestVerification> {
  let caseRoot: string;
  try {
    caseRoot = await realpath(caseRootInput);
    if (!(await lstat(caseRoot)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_ROOT_INVALID");
  }

  const actualFiles = (await listRelativeFiles(caseRoot)).filter(
    (path) => !MANIFEST_CONTROL_FILES.has(windowsPathCollisionKey(path)),
  );
  const expected = new Set(manifest.files.map((file) => windowsPathCollisionKey(file.path)));

  for (const actualFile of actualFiles) {
    if (!expected.has(windowsPathCollisionKey(actualFile))) {
      throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_EXTRA");
    }
  }
  if (actualFiles.length !== expected.size) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_MISSING");
  }

  for (const file of manifest.files) {
    await verifyListedFile(caseRoot, file);
  }

  return { manifest, verifiedFileCount: manifest.files.length };
}
