import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getBrowserVisibleDemoArtifact, safeArtifactFilename } from "@/server/demo/external-demo";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseVersion: string; artifactId: string }> },
): Promise<Response> {
  const { caseVersion, artifactId } = await context.params;
  const env = getServerEnvironment();
  const host = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (
    host === null ||
    !env.allowedHosts.includes(host) ||
    request.headers.has("forwarded") ||
    (forwardedHost !== null && forwardedHost !== host) ||
    (forwardedProto !== null &&
      forwardedProto !== new URL(env.RENTPROOF_PUBLIC_ORIGIN).protocol.slice(0, -1))
  ) {
    return new Response(null, { status: 403 });
  }
  if (
    caseVersion !== env.RENTPROOF_DEMO_CASE_VERSION ||
    !/^[a-z0-9._-]{1,128}$/u.test(artifactId)
  ) {
    return new Response(null, { status: 404 });
  }

  try {
    const artifact = await getBrowserVisibleDemoArtifact(artifactId);
    if (!artifact) return new Response(null, { status: 404 });
    const bytes = await readFile(artifact.absolutePath);
    const actualHash = createHash("sha256").update(bytes).digest();
    const expectedHash = Buffer.from(artifact.file.sha256, "hex");
    if (
      bytes.byteLength !== artifact.file.bytes ||
      actualHash.byteLength !== expectedHash.byteLength ||
      !timingSafeEqual(actualHash, expectedHash)
    ) {
      throw new Error("DEMO_ARTIFACT_CHANGED_AFTER_VERIFICATION");
    }
    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": artifact.file.mime,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="${safeArtifactFilename(artifact.file)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: { code: "DEMO_ARTIFACT_UNAVAILABLE", retryable: false } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
