import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { DemoManifest } from "@/domain/demo";
import { DemoManifestVerificationError } from "./errors";
import { verifyRuntimeManifestFiles } from "./runtime-verifier";

export interface FullDemoVerification<Truth> {
  manifest: DemoManifest;
  truth: Truth;
}

/** Test/eval-only boundary. Runtime composition roots must not import this module. */
export async function verifyFullDemoForTestOrEval<Truth>(options: {
  caseRoot: string;
  manifest: DemoManifest;
  parseTruth: (input: unknown) => Truth;
}): Promise<FullDemoVerification<Truth>> {
  await verifyRuntimeManifestFiles(options.caseRoot, options.manifest);
  const truthEntry = options.manifest.files.find(
    (file) => file.kind === "truth" && file.path === "truth/assertions.json",
  );
  if (truthEntry === undefined) {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_FILE_MISSING");
  }

  const caseRoot = await realpath(options.caseRoot);
  const truthPath = await realpath(resolve(caseRoot, ...truthEntry.path.split("/")));
  const rawTruth = await readFile(truthPath, "utf8");
  let unknownTruth: unknown;
  try {
    unknownTruth = JSON.parse(rawTruth) as unknown;
  } catch {
    throw new DemoManifestVerificationError("DEMO_MANIFEST_INVALID_JSON");
  }

  return { manifest: options.manifest, truth: options.parseTruth(unknownTruth) };
}
