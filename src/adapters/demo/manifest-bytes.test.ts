import { describe, expect, it } from "vitest";
import type { DemoManifest } from "@/domain/demo";
import { DemoManifestVerificationError } from "./errors";
import { sha256Hex, verifyAndParseManifestBytes } from "./manifest-bytes";

const encoder = new TextEncoder();

function manifest(): DemoManifest {
  return {
    schema: "rentproof.demo-manifest.v1",
    datasetId: "rentproof-golden",
    caseVersion: "golden-v1",
    synthetic: true,
    createdAt: "2026-09-02T10:00:00Z",
    sealedAt: "2026-09-02T10:01:00Z",
    files: [],
  };
}

function expectCode(action: () => unknown, code: DemoManifestVerificationError["code"]): void {
  try {
    action();
    throw new Error("Expected verification to fail");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DemoManifestVerificationError);
    expect((error as DemoManifestVerificationError).code).toBe(code);
  }
}

describe("verifyAndParseManifestBytes", () => {
  it("verifies the raw-byte sidecar before parsing", () => {
    const raw = encoder.encode(`${JSON.stringify(manifest(), null, 2)}\n`);
    const result = verifyAndParseManifestBytes(raw, encoder.encode(`${sha256Hex(raw)}\n`));
    expect(result.manifest).toEqual(manifest());
    expect(result.manifestSha256).toBe(sha256Hex(raw));
  });

  it("rejects uppercase, whitespace, and mismatched sidecars", () => {
    const raw = encoder.encode(JSON.stringify(manifest()));
    expectCode(
      () => verifyAndParseManifestBytes(raw, encoder.encode(sha256Hex(raw).toUpperCase())),
      "DEMO_MANIFEST_SEAL_INVALID",
    );
    expectCode(
      () => verifyAndParseManifestBytes(raw, encoder.encode(` ${sha256Hex(raw)}`)),
      "DEMO_MANIFEST_SEAL_INVALID",
    );
    expectCode(
      () => verifyAndParseManifestBytes(raw, encoder.encode("0".repeat(64))),
      "DEMO_MANIFEST_SEAL_MISMATCH",
    );
  });

  it("rejects BOM, invalid UTF-8, invalid JSON, and unknown schema keys", () => {
    const bomRaw = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...encoder.encode(JSON.stringify(manifest())),
    ]);
    expectCode(
      () => verifyAndParseManifestBytes(bomRaw, encoder.encode(sha256Hex(bomRaw))),
      "DEMO_MANIFEST_INVALID_UTF8",
    );

    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
    expectCode(
      () => verifyAndParseManifestBytes(invalidUtf8, encoder.encode(sha256Hex(invalidUtf8))),
      "DEMO_MANIFEST_INVALID_UTF8",
    );

    const invalidJson = encoder.encode("{");
    expectCode(
      () => verifyAndParseManifestBytes(invalidJson, encoder.encode(sha256Hex(invalidJson))),
      "DEMO_MANIFEST_INVALID_JSON",
    );

    const unknownKey = encoder.encode(JSON.stringify({ ...manifest(), extra: true }));
    expectCode(
      () => verifyAndParseManifestBytes(unknownKey, encoder.encode(sha256Hex(unknownKey))),
      "DEMO_MANIFEST_SCHEMA_INVALID",
    );
  });

  it("rejects manifests larger than one MiB before seal parsing", () => {
    expectCode(
      () => verifyAndParseManifestBytes(new Uint8Array(1_048_577), encoder.encode("not-a-sidecar")),
      "DEMO_MANIFEST_TOO_LARGE",
    );
  });
});
