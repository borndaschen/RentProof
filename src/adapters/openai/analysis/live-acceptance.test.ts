// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { it, expect } from "vitest";
import OpenAI from "openai";
import { verifyAndParseManifestBytes } from "@/adapters/demo/manifest-bytes";
import { verifyRuntimeManifestFiles } from "@/adapters/demo/runtime-verifier";
import { SharpImageSanitizer } from "@/adapters/ingestion/sharp/sharp-image-sanitizer";
import { extractTextPdf } from "@/adapters/documents/pdfjs/extract-text";
import { pdfJsEngine } from "@/adapters/documents/pdfjs/pdfjs-engine";
import { OpenAIAnalysisError, OpenAITerraAnalysisAdapter } from "./adapter";
import type { TerraAnalysisInput } from "./contracts";

it.skipIf(process.env["RENTPROOF_EXTRACTION_ACCEPTANCE"] !== "1" || Boolean(process.env["CI"]))(
  "accepts sealed golden artifacts through the actual Terra extraction boundary",
  async () => {
    process.loadEnvFile(".env.local");
    if (process.env["RENTPROOF_LLM_MODE"] !== "live") throw new Error("LIVE_OPT_IN_REQUIRED");
    const key = process.env["OPENAI_API_KEY"];
    if (!key) throw new Error("LIVE_KEY_REQUIRED");
    const root = join(process.env["USERPROFILE"] ?? "", "RentProof-Demo/cases/golden-v1");
    const verified = verifyAndParseManifestBytes(
      await readFile(join(root, "manifest.json")),
      await readFile(join(root, "manifest.sha256")),
    );
    await verifyRuntimeManifestFiles(root, verified.manifest);
    const image = async (path: string, mime: string, artifactId: string) => {
      const result = await new SharpImageSanitizer().sanitize(
        await readFile(join(root, path)),
        mime,
      );
      if (!result.ok) throw new Error(result.code);
      return {
        artifactId,
        mime: result.derivative.mime,
        base64: Buffer.from(result.derivative.bytes).toString("base64"),
      };
    };
    const caseId = "case_live_acceptance_00001";
    const pdf = await extractTextPdf({
      bytes: await readFile(join(root, "contract/synthetic-lease.pdf")),
      engine: pdfJsEngine,
    });
    const inputs: TerraAnalysisInput[] = [
      {
        stage: "listing.extract",
        caseId,
        artifact: {
          kind: "image",
          image: await image(
            "listing/synthetic-listing.png",
            "image/png",
            "listing_live_acceptance_01",
          ),
        },
      },
      {
        stage: "evidence.extract",
        caseId,
        images: [await image("viewing/view-01.jpg", "image/jpeg", "evidence_live_acceptance_01")],
      },
      {
        stage: "contract.extract",
        caseId,
        artifactId: "contract_live_acceptance_01",
        pages: pdf.pages.map(({ page, text }) => ({ page, text })),
      },
    ];
    const client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 180_000 });
    let attempts = 0;
    const adapter = new OpenAITerraAnalysisAdapter({
      async parse(request) {
        if (++attempts > 3) throw new Error("ACCEPTANCE_ATTEMPT_CAP");
        try {
          const response = await client.responses.parse(request);
          process.stdout.write(
            JSON.stringify({
              providerStatus: response.status,
              inputTokens: response.usage?.input_tokens,
              outputTokens: response.usage?.output_tokens,
              reasoningTokens: response.usage?.output_tokens_details.reasoning_tokens,
            }) + "\n",
          );
          return { response, attempts: 1 };
        } catch (error) {
          if (error instanceof OpenAI.APIError)
            process.stdout.write(
              JSON.stringify({ status: error.status, code: error.code, param: error.param }) + "\n",
            );
          throw error;
        }
      },
    });
    const results: boolean[] = [];
    const selected = inputs.filter(
      (input) =>
        !process.env["RENTPROOF_ACCEPTANCE_STAGE"] ||
        input.stage === process.env["RENTPROOF_ACCEPTANCE_STAGE"],
    );
    for (const input of selected) {
      try {
        const result = await adapter.analyze(input);
        process.stdout.write(
          JSON.stringify({
            stage: input.stage,
            ok: true,
            locatorCount: result.sourceLocators.length,
            usage: result.provenance.usage,
            model: result.provenance.resolvedModel,
            tier: result.provenance.resolvedServiceTier,
          }) + "\n",
        );
        results.push(result.sourceLocators.length > 0 && result.provenance.usage.known);
      } catch (error) {
        process.stdout.write(
          JSON.stringify({
            stage: input.stage,
            ok: false,
            reason: error instanceof OpenAIAnalysisError ? error.code : "LOCAL_VALIDATION_FAILED",
          }) + "\n",
        );
        results.push(false);
      }
    }
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(Boolean)).toBe(true);
  },
  600_000,
);
