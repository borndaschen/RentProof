import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { verifyAndParseManifestBytes } from "./manifest-bytes";
import { verifyRuntimeManifestFiles } from "./runtime-verifier";
import { verifyFullDemoForTestOrEval } from "./test-eval-full-verifier";

const demoRoot =
  process.env["RENTPROOF_DEMO_DIR"]?.trim() ||
  join(process.env["USERPROFILE"] ?? "", "RentProof-Demo");
const caseRoot = join(demoRoot, "cases", "golden-v1");
const externalFixtureExists = existsSync(join(caseRoot, "manifest.json"));

const GoldenTruthSchema = z
  .object({
    schema: z.literal("rentproof.golden-truth.v1"),
    synthetic: z.literal(true),
    claims: z.array(
      z
        .object({
          id: z.string(),
          expected: z.enum(["supported", "contradicted", "insufficient_evidence"]),
        })
        .passthrough(),
    ),
    observation: z.object({ expected: z.literal("follow_up_required") }).passthrough(),
    fraudSignal: z.object({ id: z.literal("FRS-001") }).passthrough(),
    ruleChecks: z.array(z.object({ ruleId: z.string(), expected: z.string() }).strict()),
  })
  .strict();

describe("external golden-v1 fixture", () => {
  it.skipIf(!externalFixtureExists)(
    "verifies the seal, complete inventory, and human truth",
    async () => {
      const verifiedManifest = verifyAndParseManifestBytes(
        await readFile(join(caseRoot, "manifest.json")),
        await readFile(join(caseRoot, "manifest.sha256")),
      );
      expect(verifiedManifest.manifest.synthetic).toBe(true);
      expect(verifiedManifest.manifest.caseVersion).toBe("golden-v1");
      expect(verifiedManifest.manifest.files).toHaveLength(18);

      const runtime = await verifyRuntimeManifestFiles(caseRoot, verifiedManifest.manifest);
      expect(runtime.verifiedFileCount).toBe(18);

      const evaluation = await verifyFullDemoForTestOrEval({
        caseRoot,
        manifest: verifiedManifest.manifest,
        parseTruth: (value) => GoldenTruthSchema.parse(value),
      });
      expect(evaluation.truth.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "claim-washing-machine",
            expected: "insufficient_evidence",
          }),
          expect.objectContaining({ id: "claim-electricity-rate", expected: "contradicted" }),
        ]),
      );
    },
    20_000,
  );
});
