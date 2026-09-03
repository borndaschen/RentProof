import { z } from "zod";
import type { ServerEnvironment } from "./env";

export const RuntimeStatusProjectionSchema = z
  .object({
    schemaVersion: z.literal("rentproof.runtime-status.v1"),
    llmMode: z.enum(["fixture", "live"]),
    deploymentProfile: z.enum(["local_development", "lan_secure_demo"]),
    transport: z.enum(["http", "https"]),
    dataPolicy: z.enum(["synthetic_only", "real_data_enabled"]),
    projectLimits: z.enum(["confirmed", "unverified"]),
    authMode: z.enum(["synthetic", "self_hosted"]),
    ruleProfile: z.enum(["p0", "p1"]),
  })
  .strict();

export type RuntimeStatusProjection = z.infer<typeof RuntimeStatusProjectionSchema>;

export function createRuntimeStatusProjection(
  environment: Pick<
    ServerEnvironment,
    | "RENTPROOF_LLM_MODE"
    | "RENTPROOF_DEPLOYMENT_PROFILE"
    | "RENTPROOF_ALLOW_REAL_DATA"
    | "OPENAI_PROJECT_LIMITS_CONFIRMED"
    | "RENTPROOF_AUTH_MODE"
    | "RENTPROOF_RULE_PROFILE"
  >,
): RuntimeStatusProjection {
  return RuntimeStatusProjectionSchema.parse({
    schemaVersion: "rentproof.runtime-status.v1",
    llmMode: environment.RENTPROOF_LLM_MODE,
    deploymentProfile: environment.RENTPROOF_DEPLOYMENT_PROFILE,
    transport: environment.RENTPROOF_DEPLOYMENT_PROFILE === "lan_secure_demo" ? "https" : "http",
    dataPolicy:
      environment.RENTPROOF_ALLOW_REAL_DATA === "true" ? "real_data_enabled" : "synthetic_only",
    projectLimits:
      environment.OPENAI_PROJECT_LIMITS_CONFIRMED === "true" ? "confirmed" : "unverified",
    authMode: environment.RENTPROOF_AUTH_MODE === "self_hosted" ? "self_hosted" : "synthetic",
    ruleProfile: environment.RENTPROOF_RULE_PROFILE,
  });
}
