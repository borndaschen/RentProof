import { z } from "zod";
import type { ServerEnvironment } from "./env";

export const RuntimeStatusProjectionSchema = z
  .object({
    schemaVersion: z.literal("rentproof.runtime-status.v1"),
    llmMode: z.enum(["fixture", "live"]),
    deploymentProfile: z.enum(["local_development", "lan_development"]),
    transport: z.literal("http"),
    dataPolicy: z.literal("synthetic_only"),
    projectLimits: z.enum(["confirmed", "unverified"]),
    authMode: z.enum(["synthetic", "self_hosted_local"]),
    ruleProfile: z.enum(["p0", "p1"]),
  })
  .strict();

export type RuntimeStatusProjection = z.infer<typeof RuntimeStatusProjectionSchema>;

export function createRuntimeStatusProjection(
  environment: Pick<
    ServerEnvironment,
    | "RENTPROOF_LLM_MODE"
    | "RENTPROOF_DEPLOYMENT_PROFILE"
    | "OPENAI_PROJECT_LIMITS_CONFIRMED"
    | "RENTPROOF_AUTH_MODE"
    | "RENTPROOF_RULE_PROFILE"
  >,
): RuntimeStatusProjection {
  return RuntimeStatusProjectionSchema.parse({
    schemaVersion: "rentproof.runtime-status.v1",
    llmMode: environment.RENTPROOF_LLM_MODE,
    deploymentProfile: environment.RENTPROOF_DEPLOYMENT_PROFILE,
    transport: "http",
    dataPolicy: "synthetic_only",
    projectLimits:
      environment.OPENAI_PROJECT_LIMITS_CONFIRMED === "true" ? "confirmed" : "unverified",
    authMode: environment.RENTPROOF_AUTH_MODE === "self_hosted" ? "self_hosted_local" : "synthetic",
    ruleProfile: environment.RENTPROOF_RULE_PROFILE,
  });
}
