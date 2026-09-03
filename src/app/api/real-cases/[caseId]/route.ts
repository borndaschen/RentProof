import { resolveCurrentCaseActor } from "@/server/auth/current-actor";
import { validateSelfHostedAuthMutation } from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";
import { getRealDemoRuntime } from "@/server/real-demo";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
    !validateSelfHostedAuthMutation(request, environment)
  ) {
    return errorResponse(404, "REAL_DEMO_ROUTE_UNAVAILABLE");
  }
  try {
    const actor = await resolveCurrentCaseActor(request);
    const { caseId } = await context.params;
    await (await getRealDemoRuntime()).service.deleteCase(actor, caseId);
    return new Response(null, { status: 204, headers: privateHeaders() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "REAL_DEMO_AUTH_REQUIRED") return errorResponse(401, code);
    if (code === "REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN") return errorResponse(404, code);
    return errorResponse(503, "REAL_DEMO_UNAVAILABLE");
  }
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: privateHeaders() });
}

function privateHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}
