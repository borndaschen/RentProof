import { z } from "zod";
import { consumeSyntheticMaterialConfirmation } from "@/server/conversation/confirmation/runtime";
import {
  readBoundedConfirmationJson,
  validateConfirmationRequest,
} from "@/server/conversation/confirmation/request-guard";

export const runtime = "nodejs";

const BodySchema = z.object({}).strict();
const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string; confirmationId: string }> },
): Promise<Response> {
  if (!validateConfirmationRequest(request)) return new Response(null, { status: 403 });
  const { caseId, confirmationId } = await context.params;
  if (caseId !== "golden-v1" || !IdSchema.safeParse(confirmationId).success) {
    return new Response(null, { status: 404 });
  }
  const csrfToken = request.headers.get("x-csrf-token");
  if (!csrfToken)
    return Response.json({ error: { code: "CONFIRMATION_CSRF_INVALID" } }, { status: 403 });
  try {
    if (!BodySchema.safeParse(await readBoundedConfirmationJson(request)).success) {
      throw new Error("invalid");
    }
  } catch {
    return Response.json({ error: { code: "CONFIRMATION_REQUEST_INVALID" } }, { status: 400 });
  }
  const result = await consumeSyntheticMaterialConfirmation({ confirmationId, csrfToken });
  return Response.json(result, {
    status: result.ok ? 200 : result.code === "CONFIRMATION_CSRF_INVALID" ? 403 : 409,
    headers: { "Cache-Control": "private, no-store" },
  });
}
