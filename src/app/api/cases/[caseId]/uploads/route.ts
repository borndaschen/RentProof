import {
  getSyntheticUploadService,
  getSyntheticUploadSourceBucketKey,
} from "@/server/uploads/runtime";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const { caseId } = await context.params;
  const result = await getSyntheticUploadService().handle({
    caseId,
    sourceIp: getSyntheticUploadSourceBucketKey(),
    headers: request.headers,
    stream: requestBody(request.body),
  });
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  return result.ok
    ? Response.json(result.receipt, { status: result.status, headers })
    : Response.json(
        {
          error: {
            code: result.code,
            retryable: result.status === 429 || result.status === 503,
            ...(result.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: result.retryAfterSeconds }),
          },
        },
        { status: result.status, headers },
      );
}

async function* requestBody(body: ReadableStream<Uint8Array> | null): AsyncIterable<unknown> {
  if (body === null) {
    return;
  }
  const reader = body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}
