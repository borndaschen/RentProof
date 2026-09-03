import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getVerifiedExternalDemo } from "./external-demo";

const FallbackSchema = z
  .object({
    schema: z.literal("rentproof.fixture-analysis.v1"),
    synthetic: z.literal(true),
    provenance: z
      .object({
        mode: z.literal("fixture"),
        caseVersion: z.literal("golden-v1"),
        requestedServiceTier: z.literal("default"),
        resolvedServiceTier: z.literal("fixture_no_provider_call"),
      })
      .strict(),
    findings: z.array(
      z
        .object({
          claimId: z.string().min(1).max(128),
          status: z.enum(["supported", "contradicted", "insufficient_evidence"]),
          sourceRefs: z.array(z.string().min(1).max(160)).min(1).max(8),
        })
        .strict(),
    ),
    nextActions: z.array(z.string().min(1).max(240)).min(1).max(10),
  })
  .strict();

export const PublicFixtureAnalysisSnapshotSchema = z
  .object({
    schemaVersion: z.literal("rentproof.fixture-analysis-snapshot.v1"),
    snapshotId: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u),
    caseVersion: z.literal("golden-v1"),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    executionMode: z.literal("fixture"),
    providerCalled: z.literal(false),
    findings: FallbackSchema.shape.findings,
    nextActions: FallbackSchema.shape.nextActions,
    reportHref: z.literal("/reports/golden-v1"),
  })
  .strict();

export type PublicFixtureAnalysisSnapshot = z.infer<typeof PublicFixtureAnalysisSnapshotSchema>;

export async function loadFixtureAnalysisSnapshot(): Promise<PublicFixtureAnalysisSnapshot> {
  const demo = await getVerifiedExternalDemo();
  const fallback = demo.files.find(
    (file) => file.kind === "fallback" && file.id === "fallback-analysis-json",
  );
  if (!fallback) throw new Error("FIXTURE_ANALYSIS_UNAVAILABLE");
  const bytes = await readFile(join(demo.caseRoot, ...fallback.path.split("/")));
  const actual = createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(fallback.sha256, "hex");
  if (
    bytes.byteLength !== fallback.bytes ||
    actual.byteLength !== expected.byteLength ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error("FIXTURE_ANALYSIS_TAMPERED");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = FallbackSchema.parse(JSON.parse(text) as unknown);
  return PublicFixtureAnalysisSnapshotSchema.parse({
    schemaVersion: "rentproof.fixture-analysis-snapshot.v1",
    snapshotId: `snapshot_fixture_${demo.manifestHash.slice(0, 24)}`,
    caseVersion: parsed.provenance.caseVersion,
    manifestHash: demo.manifestHash,
    executionMode: "fixture",
    providerCalled: false,
    findings: parsed.findings,
    nextActions: parsed.nextActions,
    reportHref: "/reports/golden-v1",
  });
}
