import { z } from "zod";
import { readBoundedAuthJson } from "@/server/auth/http";
import { resolveCurrentTransferActors } from "@/server/auth/current-actor";
import { validateSelfHostedAuthMutation } from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";
import { privateNoStoreHeaders } from "@/server/http/private-response";
import { getRealDemoRuntime } from "@/server/real-demo";

export const runtime = "nodejs";

const TransferBodySchema = z
  .object({ confirmation: z.literal("SAVE_GUEST_CASE_TO_ACCOUNT") })
  .strict();

export async function POST(
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
  let body: z.infer<typeof TransferBodySchema>;
  try {
    body = TransferBodySchema.parse(await readBoundedAuthJson(request));
  } catch {
    return errorResponse(400, "REAL_DEMO_REQUEST_INVALID");
  }
  try {
    const actors = await resolveCurrentTransferActors(request);
    if (!actors) return errorResponse(401, "REAL_DEMO_AUTH_REQUIRED");
    if (!actors.reverified) return errorResponse(403, "REAL_DEMO_REVERIFICATION_REQUIRED");
    const { caseId } = await context.params;
    await (
      await getRealDemoRuntime()
    ).service.transferGuestCase(actors.guest, actors.user, caseId, body.confirmation);
    return Response.json(
      { schemaVersion: "rentproof.guest-case-transfer.v1", status: "transferred", caseId },
      { status: 200, headers: privateNoStoreHeaders() },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "REAL_DEMO_TRANSFER_ALREADY_COMPLETED") return errorResponse(409, code);
    if (code === "REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN") return errorResponse(404, code);
    return errorResponse(503, "REAL_DEMO_UNAVAILABLE");
  }
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: privateNoStoreHeaders() });
}
