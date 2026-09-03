import { cookies } from "next/headers";
import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
import {
  authUnavailableResponse,
  clearSessionCookie,
  guardAuthMutation,
  privateHeaders,
  readSessionCookie,
} from "@/server/auth/http";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  const blocked = guardAuthMutation(request, environment, "logout");
  if (blocked) return blocked;
  try {
    await (
      await getSelfHostedAuthRuntime()
    ).service.logout(readSessionCookie(request, environment));
  } catch {
    return authUnavailableResponse();
  }
  clearSessionCookie(await cookies(), environment);
  return new Response(null, { status: 204, headers: privateHeaders() });
}
