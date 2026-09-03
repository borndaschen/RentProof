import { describe, expect, it } from "vitest";
import { DemoManifestSchema, isWindowsSafeManifestPath, type DemoManifest } from "./manifest";

function validManifest(): DemoManifest {
  return {
    schema: "rentproof.demo-manifest.v1",
    datasetId: "rentproof-golden",
    caseVersion: "golden-v1",
    synthetic: true,
    createdAt: "2026-09-02T10:00:00Z",
    sealedAt: "2026-09-02T10:01:00Z",
    files: [
      {
        id: "listing-image-1",
        path: "listing/ad.png",
        kind: "listing",
        mime: "image/png",
        bytes: 123,
        sha256: "a".repeat(64),
        provenance: { source: "synthetic generation", license: "project demo use" },
      },
    ],
  };
}

describe("DemoManifestSchema", () => {
  it("accepts the strict v1 contract", () => {
    expect(DemoManifestSchema.safeParse(validManifest()).success).toBe(true);
  });

  it("rejects unknown keys, non-synthetic data, and over 100 entries", () => {
    const withUnknown = { ...validManifest(), unexpected: true };
    expect(DemoManifestSchema.safeParse(withUnknown).success).toBe(false);

    const nonSynthetic = { ...validManifest(), synthetic: false };
    expect(DemoManifestSchema.safeParse(nonSynthetic).success).toBe(false);

    const tooManyFiles = {
      ...validManifest(),
      files: Array.from({ length: 101 }, (_, index) => ({
        ...validManifest().files[0],
        id: `file-${index}`,
        path: `listing/file-${index}.png`,
      })),
    };
    expect(DemoManifestSchema.safeParse(tooManyFiles).success).toBe(false);
  });

  it("rejects duplicate ids and Windows case-insensitive path collisions", () => {
    const file = validManifest().files[0];
    const duplicateId = {
      ...validManifest(),
      files: [file, { ...file, path: "listing/other.png" }],
    };
    expect(DemoManifestSchema.safeParse(duplicateId).success).toBe(false);

    const caseCollision = {
      ...validManifest(),
      files: [file, { ...file, id: "other", path: "LISTING/AD.PNG" }],
    };
    expect(DemoManifestSchema.safeParse(caseCollision).success).toBe(false);
  });
});

describe("isWindowsSafeManifestPath", () => {
  it.each([
    "/absolute.png",
    "C:/drive.png",
    "\\\\server\\share.png",
    "../escape.png",
    "listing/./image.png",
    "listing//image.png",
    "listing/CON.txt",
    "listing/trailing.",
    "listing/trailing ",
    "listing/a?.png",
    "listing/e\u0301.png",
  ])("rejects unsafe or non-normalized path %s", (path) => {
    expect(isWindowsSafeManifestPath(path)).toBe(false);
  });

  it("accepts a normalized forward-slash relative path", () => {
    expect(isWindowsSafeManifestPath("viewing/images/牆面-01.png")).toBe(true);
  });
});
