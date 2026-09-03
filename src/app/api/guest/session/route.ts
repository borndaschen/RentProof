import { cookies } from "next/headers";
import { readUniqueCookie, validateSelfHostedAuthRead } from "@/server/auth/request-guard";
import { GUEST_SESSION_COOKIE, getGuestSessionRuntime } from "@/server/auth/guest-session";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
    !validateSelfHostedAuthRead(request, environment)
  ) {
    return Response.json({ error: { code: "GUEST_SESSION_UNAVAILABLE" } }, { status: 404 });
  }
  try {
    const cookieStore = await cookies();
    const existing = readUniqueCookie(request.headers.get("cookie"), GUEST_SESSION_COOKIE);
    const runtime = await getGuestSessionRuntime();
    const actor = await runtime.resolve(existing ?? undefined);
    if (actor) {
      return Response.json(
        { schemaVersion: "rentproof.guest-session.v1", status: "guest" },
        { headers: privateHeaders() },
      );
    }
    const issued = await runtime.issue();
    cookieStore.set({
      name: GUEST_SESSION_COOKIE,
      value: issued.rawToken,
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 24 * 60 * 60,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return Response.json(
      { schemaVersion: "rentproof.guest-session.v1", status: "guest" },
      { status: 201, headers: privateHeaders() },
    );
  } catch {
    return Response.json(
      { error: { code: "GUEST_SESSION_UNAVAILABLE" } },
      { status: 503, headers: privateHeaders() },
    );
  }
}

function privateHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}
