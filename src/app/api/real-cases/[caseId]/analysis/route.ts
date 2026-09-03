import { OpenAIAnalysisError } from "@/adapters/openai/analysis/adapter";
import { resolveCurrentCaseActor } from "@/server/auth/current-actor";
import { validateSelfHostedAuthMutation } from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";
import { analyzeRealCase } from "@/server/real-demo/analysis";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const environment = getServerEnvironment();
  const apiKey = process.env["OPENAI_API_KEY"];
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
    environment.RENTPROOF_LLM_MODE !== "live" ||
    environment.OPENAI_PROJECT_LIMITS_CONFIRMED !== "true" ||
    !apiKey ||
    !validateSelfHostedAuthMutation(request, environment)
  ) {
    return errorResponse(404, "REAL_ANALYSIS_ROUTE_UNAVAILABLE");
  }
  try {
    const actor = await resolveCurrentCaseActor(request);
    if (!actor) return errorResponse(401, "REAL_DEMO_AUTH_REQUIRED");
    const { caseId } = await context.params;
    const snapshot = await analyzeRealCase({ actor, caseId, apiKey });
    return Response.json(snapshot, { status: 201, headers: privateHeaders() });
  } catch (error) {
    if (error instanceof OpenAIAnalysisError) {
      return errorResponse(
        error.code === "ANALYSIS_PROVIDER_RATE_LIMITED" ? 429 : 502,
        error.code,
        error.code === "ANALYSIS_PROVIDER_RATE_LIMITED" ? 30 : undefined,
      );
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "REAL_DEMO_AUTH_REQUIRED") return errorResponse(401, code);
    if (code === "REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN") return errorResponse(404, code);
    if (code === "REAL_DEMO_ARTIFACT_SET_INCOMPLETE") return errorResponse(409, code);
    if (code === "REAL_ANALYSIS_ARTIFACT_INVALID") return errorResponse(422, code);
    if (code === "REAL_ANALYSIS_BUDGET_EXCEEDED") return errorResponse(429, code, 60);
    if (code.startsWith("REAL_ANALYSIS_BUDGET_")) return errorResponse(502, code);
    return errorResponse(503, "REAL_ANALYSIS_UNAVAILABLE");
  }
}

function errorResponse(status: number, code: string, retryAfterSeconds?: number): Response {
  return Response.json(
    { error: { code } },
    {
      status,
      headers: {
        ...privateHeaders(),
        ...(retryAfterSeconds === undefined ? {} : { "Retry-After": String(retryAfterSeconds) }),
      },
    },
  );
}

function privateHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}
