import { cookies } from "next/headers";
import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
import {
  ResetCompleteBodySchema,
  authUnavailableResponse,
  clearSessionCookie,
  genericAcceptedResponse,
  guardAuthMutation,
  readBoundedAuthJson,
} from "@/server/auth/http";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  const blocked = guardAuthMutation(request, environment, "password-reset-complete");
  if (blocked) return blocked;
  let body;
  try {
    body = ResetCompleteBodySchema.parse(await readBoundedAuthJson(request));
  } catch {
    clearSessionCookie(await cookies(), environment);
    return genericAcceptedResponse();
  }
  try {
    await (
      await getSelfHostedAuthRuntime()
    ).service.completePasswordReset({
      rawToken: body.code,
      newPassword: body.newPassword,
    });
  } catch {
    return authUnavailableResponse();
  }
  clearSessionCookie(await cookies(), environment);
  return genericAcceptedResponse();
}
