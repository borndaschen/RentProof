import "server-only";
import { extractTextPdf, pdfJsEngine } from "@/adapters/documents/pdfjs";
import { SharpImageSanitizer } from "@/adapters/ingestion/sharp";
import { getVerifiedExternalDemo } from "@/server/demo/external-demo";
import { getServerEnvironment } from "@/server/env";
import { SyntheticUploadService } from "./synthetic-upload-service";

let service: SyntheticUploadService | undefined;

export function getSyntheticUploadService(): SyntheticUploadService {
  if (service !== undefined) {
    return service;
  }
  const env = getServerEnvironment();
  service = new SyntheticUploadService({
    profile: {
      deploymentProfile: env.RENTPROOF_DEPLOYMENT_PROFILE,
      allowRealData: false,
      llmMode: env.RENTPROOF_LLM_MODE,
      caseVersion: env.RENTPROOF_DEMO_CASE_VERSION,
      allowedHosts: env.allowedHosts,
      allowedOrigins: env.allowedOrigins,
    },
    manifestSource: {
      load: async () => {
        const demo = await getVerifiedExternalDemo();
        return {
          caseVersion: env.RENTPROOF_DEMO_CASE_VERSION,
          synthetic: true,
          manifestHash: demo.manifestHash,
          files: demo.files,
        };
      },
    },
    imageSanitizer: new SharpImageSanitizer(),
    pdfExtractor: {
      extract: async (bytes) => extractTextPdf({ bytes, engine: pdfJsEngine }),
    },
  });
  return service;
}

export function getSyntheticUploadSourceBucketKey(): string {
  const env = getServerEnvironment();
  return env.RENTPROOF_DEPLOYMENT_PROFILE === "local_development"
    ? "127.0.0.1"
    : env.RENTPROOF_BIND_HOST;
}
