import { resolveCurrentCaseActor } from "@/server/auth/current-actor";
import { readBoundedAuthJson } from "@/server/auth/http";
import { validateSelfHostedAuthMutation } from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";
import { getRealDemoRuntime } from "@/server/real-demo";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
    !validateSelfHostedAuthMutation(request, environment)
  ) {
    return errorResponse(404, "REAL_DEMO_ROUTE_UNAVAILABLE");
  }
  try {
    const actor = await resolveCurrentCaseActor(request);
    const input = await readBoundedAuthJson(request);
    const result = await (await getRealDemoRuntime()).service.createCase(actor, input);
    return Response.json(
      { schemaVersion: "rentproof.real-case-created.v1", caseId: result.caseId },
      { status: 201, headers: privateHeaders() },
    );
  } catch (error) {
    return mapError(error);
  }
}

function mapError(error: unknown): Response {
  const code = error instanceof Error ? error.message : "";
  if (code === "REAL_DEMO_AUTH_REQUIRED") return errorResponse(401, code);
  if (code === "REAL_DEMO_REQUEST_INVALID") return errorResponse(400, code);
  return errorResponse(503, "REAL_DEMO_UNAVAILABLE");
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: privateHeaders() });
}

function privateHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}
