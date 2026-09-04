import { z } from "zod";
import {
  SubsidyPrecheckInputSchema,
  SubsidySourceGovernanceError,
  assertCurrentSubsidySources,
  evaluateRentalSubsidyPrecheck115,
} from "@/domain/subsidy";
import { getServerEnvironment } from "@/server/env";
import { validateSubsidyPrecheckRequest } from "@/server/subsidy/request-boundary";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;
const RequestSchema = z
  .object({
    schemaVersion: z.literal("rentproof.rent-subsidy-precheck-input.v1"),
    input: SubsidyPrecheckInputSchema,
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  const requestError = validateSubsidyPrecheckRequest(request, environment);
  if (requestError !== null) return errorResponse(requestError.status, requestError.code);

  try {
    const parsed = RequestSchema.parse(await readBoundedJson(request));
    assertCurrentSubsidySources(new Date());
    return Response.json(evaluateRentalSubsidyPrecheck115(parsed.input), {
      status: 200,
      headers: privateHeaders(),
    });
  } catch (error) {
    if (error instanceof SubsidySourceGovernanceError) {
      return errorResponse(503, error.code);
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "SUBSIDY_PRECHECK_REQUEST_TOO_LARGE") {
      return errorResponse(413, code);
    }
    return errorResponse(400, "SUBSIDY_PRECHECK_REQUEST_INVALID");
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)
  ) {
    throw new Error("SUBSIDY_PRECHECK_REQUEST_TOO_LARGE");
  }
  if (request.body === null) throw new Error("SUBSIDY_PRECHECK_REQUEST_INVALID");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("SUBSIDY_PRECHECK_REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("SUBSIDY_PRECHECK_REQUEST_INVALID");
  return JSON.parse(text) as unknown;
}

function privateHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: privateHeaders() });
}
