import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { DemoManifest, DemoManifestFile } from "@/domain/demo";
import { DemoManifestVerificationError } from "./errors";
import { verifyRuntimeManifestFiles } from "./runtime-verifier";
import { verifyFullDemoForTestOrEval } from "./test-eval-full-verifier";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileEntry(
  path: string,
  bytes: Uint8Array,
  kind: DemoManifestFile["kind"],
): DemoManifestFile {
  return {
    id: path.replaceAll("/", "-").replaceAll(".", "-"),
    path,
    kind,
    mime: "application/json",
    bytes: bytes.byteLength,
    sha256: hash(bytes),
    provenance: { source: "synthetic test", license: "test-only" },
  };
}

function manifest(files: DemoManifestFile[]): DemoManifest {
  return {
    schema: "rentproof.demo-manifest.v1",
    datasetId: "rentproof-golden",
    caseVersion: "golden-v1",
    synthetic: true,
    createdAt: "2026-09-02T10:00:00Z",
    sealedAt: "2026-09-02T10:01:00Z",
    files,
  };
}

async function caseRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rentproof-manifest-"));
  roots.push(root);
  await writeFile(join(root, "manifest.json"), "{}");
  await writeFile(join(root, "manifest.sha256"), "0".repeat(64));
  return root;
}

async function expectCode(
  action: () => Promise<unknown>,
  code: DemoManifestVerificationError["code"],
): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code });
}

describe("verifyRuntimeManifestFiles", () => {
  it("verifies opaque truth bytes without parsing their JSON", async () => {
    const root = await caseRoot();
    const opaqueInvalidJson = new TextEncoder().encode("not-json-and-runtime-must-not-parse-it");
    await mkdir(join(root, "truth"));
    await writeFile(join(root, "truth", "assertions.json"), opaqueInvalidJson);

    const result = await verifyRuntimeManifestFiles(
      root,
      manifest([fileEntry("truth/assertions.json", opaqueInvalidJson, "truth")]),
    );

    expect(result.verifiedFileCount).toBe(1);
  });

  it("rejects missing, extra, size-mismatched, and hash-mismatched files", async () => {
    const expectedBytes = new TextEncoder().encode("expected");

    const missingRoot = await caseRoot();
    await expectCode(
      () =>
        verifyRuntimeManifestFiles(
          missingRoot,
          manifest([fileEntry("listing/ad.json", expectedBytes, "listing")]),
        ),
      "DEMO_MANIFEST_FILE_MISSING",
    );

    const extraRoot = await caseRoot();
    await writeFile(join(extraRoot, "extra.json"), "extra");
    await expectCode(
      () => verifyRuntimeManifestFiles(extraRoot, manifest([])),
      "DEMO_MANIFEST_FILE_EXTRA",
    );

    const sizeRoot = await caseRoot();
    await mkdir(join(sizeRoot, "listing"));
    await writeFile(join(sizeRoot, "listing", "ad.json"), "wrong-size");
    await expectCode(
      () =>
        verifyRuntimeManifestFiles(
          sizeRoot,
          manifest([fileEntry("listing/ad.json", expectedBytes, "listing")]),
        ),
      "DEMO_MANIFEST_FILE_SIZE_MISMATCH",
    );

    const hashRoot = await caseRoot();
    await mkdir(join(hashRoot, "listing"));
    await writeFile(join(hashRoot, "listing", "ad.json"), "different");
    const equalLengthExpected = new TextEncoder().encode("something");
    await expectCode(
      () =>
        verifyRuntimeManifestFiles(
          hashRoot,
          manifest([fileEntry("listing/ad.json", equalLengthExpected, "listing")]),
        ),
      "DEMO_MANIFEST_FILE_HASH_MISMATCH",
    );
  });

  it("rejects symlinked files", async () => {
    const root = await caseRoot();
    const outside = await mkdtemp(join(tmpdir(), "rentproof-manifest-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "ad.json"), "outside");
    await symlink(
      outside,
      join(root, "listing"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expectCode(
      () => verifyRuntimeManifestFiles(root, manifest([])),
      "DEMO_MANIFEST_FILE_UNSAFE",
    );
  });
});

describe("verifyFullDemoForTestOrEval", () => {
  it("parses truth only through the explicit test/eval boundary", async () => {
    const root = await caseRoot();
    const truthBytes = new TextEncoder().encode('{"claims":4}');
    await mkdir(join(root, "truth"));
    await writeFile(join(root, "truth", "assertions.json"), truthBytes);
    const TruthSchema = z.object({ claims: z.number().int() }).strict();

    const result = await verifyFullDemoForTestOrEval({
      caseRoot: root,
      manifest: manifest([fileEntry("truth/assertions.json", truthBytes, "truth")]),
      parseTruth: (input) => TruthSchema.parse(input),
    });

    expect(result.truth).toEqual({ claims: 4 });
  });
});
