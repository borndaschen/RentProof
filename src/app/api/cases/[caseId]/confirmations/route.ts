import { z } from "zod";
import {
  allowSyntheticConfirmationIssue,
  issueSyntheticMaterialConfirmation,
} from "@/server/conversation/confirmation/runtime";
import {
  readBoundedConfirmationJson,
  validateConfirmationRequest,
} from "@/server/conversation/confirmation/request-guard";

export const runtime = "nodejs";

const RequestSchema = z
  .object({ candidateKey: z.literal("fixture_electricity_payer_tenant") })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  if (!validateConfirmationRequest(request)) return new Response(null, { status: 403 });
  if ((await context.params).caseId !== "golden-v1") return new Response(null, { status: 404 });
  let body: unknown;
  try {
    body = await readBoundedConfirmationJson(request);
  } catch {
    return Response.json({ error: { code: "CONFIRMATION_REQUEST_INVALID" } }, { status: 400 });
  }
  if (!RequestSchema.safeParse(body).success) {
    return Response.json({ error: { code: "CONFIRMATION_REQUEST_INVALID" } }, { status: 400 });
  }
  const rate = allowSyntheticConfirmationIssue();
  if (!rate.ok) {
    return Response.json(
      { error: { code: "CONFIRMATION_RATE_LIMITED", retryable: true } },
      {
        status: 429,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(rate.retryAfterSeconds),
        },
      },
    );
  }
  const result = await issueSyntheticMaterialConfirmation({
    candidateType: "update_case_profile",
    changes: [{ field: "electricity_payer", value: { status: "known", value: "tenant" } }],
  });
  return Response.json(result, {
    status: result.ok ? 201 : 409,
    headers: { "Cache-Control": "private, no-store" },
  });
}
