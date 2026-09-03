import "server-only";
import { getServerEnvironment } from "@/server/env";

export function validateConfirmationRequest(request: Request): boolean {
  const env = getServerEnvironment();
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  return (
    host !== null &&
    env.allowedHosts.includes(host) &&
    origin !== null &&
    env.allowedOrigins.includes(origin) &&
    contentType === "application/json" &&
    !request.headers.has("forwarded") &&
    (forwardedHost === null || forwardedHost === host) &&
    (forwardedProto === null || forwardedProto === new URL(origin).protocol.slice(0, -1))
  );
}

export async function readBoundedConfirmationJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > 1_024)
  ) {
    throw new Error("CONFIRMATION_REQUEST_TOO_LARGE");
  }
  if (!request.body) throw new Error("CONFIRMATION_REQUEST_INVALID");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_024) {
        await reader.cancel();
        throw new Error("CONFIRMATION_REQUEST_TOO_LARGE");
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
  if (text.includes("\0")) throw new Error("CONFIRMATION_REQUEST_INVALID");
  return JSON.parse(text) as unknown;
}
