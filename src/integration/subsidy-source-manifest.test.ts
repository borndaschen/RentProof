import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SUBSIDY_SOURCE_SNAPSHOT_HASHES, normalizeSubsidySourceHtml } from "@/domain/subsidy";

const SourceSchema = z
  .object({
    sourceId: z.string().min(1),
    title: z.string().min(1),
    publisher: z.literal("內政部不動產資訊平台"),
    url: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "pip.moi.gov.tw" &&
        url.port === "" &&
        url.username === "" &&
        url.password === "" &&
        url.hash === ""
      );
    }),
    expectedFinalUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "pip.moi.gov.tw" &&
        url.port === "" &&
        url.username === "" &&
        url.password === "" &&
        url.hash === ""
      );
    }),
    snapshotPath: z.string().regex(/^rules\/snapshots\/2026-09-04\/[a-z0-9-]+\.html$/u),
    contentType: z.literal("text/html"),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    semanticSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    liveSemanticSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    semanticRegion: z.enum(["article", "homepage", "whole_document"]),
    semanticNormalizer: z.literal("rentproof.semantic-html.v2"),
    validation: z.array(z.string().min(1)).min(2),
  })
  .strict();

const ManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    snapshotDate: z.literal("2026-09-04"),
    jurisdiction: z.literal("TW"),
    rulesetId: z.literal("rentproof-tw-rent-subsidy-precheck"),
    rulesVersion: z.literal("115.2026-09-04.1"),
    sources: z.array(SourceSchema).length(5),
  })
  .strict();

describe("subsidy official-source manifest", () => {
  const manifestPath = resolve("rules/snapshots/2026-09-04/manifest.json");
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);

  it("keeps unique official source ids and the evaluator primary hashes aligned", () => {
    expect(new Set(manifest.sources.map((source) => source.sourceId)).size).toBe(5);
    expect(new Set(manifest.sources.map((source) => source.snapshotPath.toLowerCase())).size).toBe(
      5,
    );
    const conditions = manifest.sources.find(
      (source) => source.sourceId === "SUBSIDY_115_CONDITIONS",
    );
    const faq = manifest.sources.find((source) => source.sourceId === "SUBSIDY_115_QA");
    expect(conditions?.sha256).toBe(SUBSIDY_SOURCE_SNAPSHOT_HASHES.MOI_115_CONDITIONS);
    expect(faq?.sha256).toBe(SUBSIDY_SOURCE_SNAPSHOT_HASHES.MOI_115_FAQ);
  });

  it("verifies every locally available ignored snapshot against bytes, hash, and sentinels", () => {
    for (const source of manifest.sources) {
      const snapshotPath = resolve(source.snapshotPath);
      if (!existsSync(snapshotPath)) continue;
      const bytes = readFileSync(snapshotPath);
      const text = bytes.toString("utf8");
      expect(bytes.byteLength, source.sourceId).toBe(source.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), source.sourceId).toBe(source.sha256);
      expect(
        createHash("sha256")
          .update(normalizeSubsidySourceHtml(text, source.semanticRegion))
          .digest("hex"),
        source.sourceId,
      ).toBe(source.semanticSha256);
      for (const validation of source.validation) {
        const separator = validation.indexOf(":");
        const operation = validation.slice(0, separator);
        const expected = validation.slice(separator + 1);
        expect(["contains", "not-contains"], source.sourceId).toContain(operation);
        expect(expected, `${source.sourceId} has a valid sentinel`).toBeTruthy();
        if (operation === "contains") expect(text, source.sourceId).toContain(expected);
        if (operation === "not-contains") expect(text, source.sourceId).not.toContain(expected);
      }
    }
  });
});
