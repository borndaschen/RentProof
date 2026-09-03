import { cookies } from "next/headers";
import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
import {
  LoginBodySchema,
  authInvalidResponse,
  authMalformedResponse,
  authUnavailableResponse,
  guardAuthMutation,
  privateHeaders,
  readBoundedAuthJson,
  setSessionCookie,
} from "@/server/auth/http";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  const blocked = guardAuthMutation(request, environment, "login");
  if (blocked) return blocked;
  let body;
  try {
    body = LoginBodySchema.parse(await readBoundedAuthJson(request));
  } catch {
    return authMalformedResponse();
  }
  try {
    const result = await (await getSelfHostedAuthRuntime()).service.authenticate(body);
    if (result.status !== "authenticated") return authInvalidResponse();
    setSessionCookie(await cookies(), environment, result.cookie);
    return Response.json({ status: "authenticated" }, { status: 200, headers: privateHeaders() });
  } catch {
    return authUnavailableResponse();
  }
}
