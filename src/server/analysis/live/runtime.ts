import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOpenAITerraAnalysisAdapter } from "@/adapters/openai/analysis/adapter";
import { InMemoryEvidenceBudgetRepository } from "@/application/analysis-budget";
import { getVerifiedExternalDemo } from "@/server/demo/external-demo";
import type { PrivateUploadRecord } from "@/server/uploads/contracts";
import { z } from "zod";
import {
  InMemoryLiveSnapshotRepository,
  LiveAnalysisService,
  type RunLiveAnalysisResult,
} from "./live-analysis-service";

const InteractionFileSchema = z
  .object({
    schema: z.literal("rentproof.synthetic-interaction.v1"),
    synthetic: z.literal(true),
    firstInPersonViewingAt: z.iso.datetime({ offset: true }),
    paymentRequestedAt: z.iso.datetime({ offset: true }),
    paymentType: z.enum(["reservation_deposit", "deposit", "rent", "other"]),
    amountTwd: z.string().regex(/^(?:0|[1-9][0-9]{0,9})$/u),
    text: z.string().min(1).max(100_000),
  })
  .strict();

const budget = new InMemoryEvidenceBudgetRepository({ now: () => new Date() });
const snapshots = new InMemoryLiveSnapshotRepository();

export async function executeLiveSyntheticAnalysis(input: {
  apiKey: string;
  caseId: "golden-v1";
  receipts: readonly PrivateUploadRecord[];
  ruleProfile?: "p0" | "p1";
}): Promise<RunLiveAnalysisResult> {
  const demo = await getVerifiedExternalDemo();
  const interactionFile = demo.files.find(
    (file) =>
      file.kind === "interaction" &&
      file.id === "interaction-payment-request-json" &&
      file.mime === "application/json",
  );
  if (interactionFile === undefined) {
    return { ok: false, code: "ANALYSIS_DETERMINISTIC_COMPOSE_FAILED" };
  }
  const bytes = await readFile(join(demo.caseRoot, ...interactionFile.path.split("/")));
  const actual = createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(interactionFile.sha256, "hex");
  if (
    bytes.byteLength !== interactionFile.bytes ||
    actual.byteLength !== expected.byteLength ||
    !timingSafeEqual(actual, expected)
  ) {
    return { ok: false, code: "ANALYSIS_DETERMINISTIC_COMPOSE_FAILED" };
  }
  let parsed: z.infer<typeof InteractionFileSchema>;
  try {
    parsed = InteractionFileSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
    );
  } catch {
    return { ok: false, code: "ANALYSIS_DETERMINISTIC_COMPOSE_FAILED" };
  }

  const service = new LiveAnalysisService({
    analyzer: createOpenAITerraAnalysisAdapter(input.apiKey),
    budget,
    snapshots,
  });
  return service.run({
    caseId: input.caseId,
    manifestHash: demo.manifestHash,
    receipts: input.receipts,
    interaction: {
      artifactId: interactionFile.id,
      text: parsed.text,
      paymentRequestedAt: parsed.paymentRequestedAt,
      firstInPersonViewingAt: parsed.firstInPersonViewingAt,
    },
    ruleProfile: input.ruleProfile ?? "p0",
  });
}
