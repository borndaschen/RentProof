import { z } from "zod";
import { resolveCurrentCaseActor } from "@/server/auth/current-actor";
import {
  validateSelfHostedAuthMutation,
  validateSelfHostedAuthRead,
} from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";
import { privateNoStoreHeaders } from "@/server/http/private-response";
import { getRealDemoRuntime } from "@/server/real-demo";

export const runtime = "nodejs";
type Context = { params: Promise<{ caseId: string; artifactId: string }> };
const ConfirmationSchema = z
  .object({
    confirmationId: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u),
    explicitlyConfirmed: z.literal(true),
  })
  .strict();

async function handle(request: Request, context: Context, action: "read" | "confirm" | "cancel") {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
    !(action === "read"
      ? validateSelfHostedAuthRead(request, environment)
      : validateSelfHostedAuthMutation(request, environment))
  ) {
    return response({ error: { code: "REAL_DEMO_ROUTE_UNAVAILABLE" } }, 404);
  }
  try {
    const actor = await resolveCurrentCaseActor(request, action !== "read");
    if (!actor) return response({ error: { code: "REAL_DEMO_AUTH_REQUIRED" } }, 401);
    const { caseId, artifactId } = await context.params;
    const service = (await getRealDemoRuntime()).processing.service;
    if (action === "read") return response(await service.status(actor, caseId, artifactId));
    if (action === "cancel") {
      await service.cancel(actor, caseId, artifactId);
      return new Response(null, { status: 204, headers: privateNoStoreHeaders() });
    }
    const input = ConfirmationSchema.parse(await readSmallJson(request));
    return response(await service.confirm(actor, caseId, artifactId, input.confirmationId), 201);
  } catch (error) {
    if (error instanceof z.ZodError)
      return response({ error: { code: "OCR_CONFIRMATION_REQUEST_INVALID" } }, 400);
    const code = error instanceof Error ? error.message : "";
    if (code === "REAL_DEMO_AUTH_REQUIRED") return response({ error: { code } }, 401);
    if (code.endsWith("NOT_FOUND_OR_FORBIDDEN"))
      return response({ error: { code: "PROCESSING_NOT_FOUND_OR_FORBIDDEN" } }, 404);
    if (
      /^(OCR_CONFIRMATION_(USED|EXPIRED|STALE)|PROCESSING_(REVISION_STALE|STATE_STALE|ALREADY_AVAILABLE)|OCR_HUMAN_CONFIRMATION_REQUIRED)$/u.test(
        code,
      )
    ) {
      return response({ error: { code } }, 409);
    }
    if (code === "PROCESSING_REQUEST_TOO_LARGE" || code === "PROCESSING_ENCODING_INVALID")
      return response({ error: { code } }, 400);
    return response({ error: { code: "PROCESSING_UNAVAILABLE" } }, 503);
  }
}

export function GET(request: Request, context: Context) {
  return handle(request, context, "read");
}
export function POST(request: Request, context: Context) {
  return handle(request, context, "confirm");
}
export function DELETE(request: Request, context: Context) {
  return handle(request, context, "cancel");
}

function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers: privateNoStoreHeaders() });
}

async function readSmallJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("PROCESSING_ENCODING_INVALID");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > 1_024) {
        await reader.cancel();
        throw new Error("PROCESSING_REQUEST_TOO_LARGE");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    if (text.includes("\0")) throw new Error();
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("PROCESSING_ENCODING_INVALID");
  }
}
