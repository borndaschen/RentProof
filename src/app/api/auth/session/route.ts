import { cookies } from "next/headers";
import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
import {
  authUnavailableResponse,
  clearSessionCookie,
  ensurePreAuthCookie,
  guardAuthRead,
  issueCsrfCookie,
  privateHeaders,
  readSessionCookie,
} from "@/server/auth/http";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  const blocked = guardAuthRead(request, environment, "session");
  if (blocked) return blocked;
  try {
    const cookieStore = await cookies();
    const csrfToken = issueCsrfCookie(cookieStore, environment);
    ensurePreAuthCookie(request, cookieStore, environment);
    const auth = await getSelfHostedAuthRuntime();
    const resolution = await auth.service.resolveSession(
      readSessionCookie(request, environment),
      false,
    );
    if (resolution.status === "signed_out") {
      clearSessionCookie(cookieStore, environment);
    }
    return Response.json(
      {
        schemaVersion: "rentproof.self-hosted-auth-session.v1",
        status: resolution.status,
        csrfToken,
      },
      { status: 200, headers: privateHeaders() },
    );
  } catch {
    return authUnavailableResponse();
  }
}
