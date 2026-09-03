import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
import {
  RegisterBodySchema,
  authMalformedResponse,
  authUnavailableResponse,
  classifyAuthRegisterFailure,
  genericAcceptedResponse,
  guardAuthMutation,
  readPreAuthCookie,
  readBoundedAuthJson,
} from "@/server/auth/http";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  const blocked = guardAuthMutation(request, environment, "register");
  if (blocked) return blocked;
  let body;
  try {
    body = RegisterBodySchema.parse(await readBoundedAuthJson(request));
  } catch {
    return authMalformedResponse();
  }
  try {
    const runtime = await getSelfHostedAuthRuntime();
    const rawContext = readPreAuthCookie(request, environment);
    const deliveryContextDigest = rawContext ? runtime.digestPreAuthContext(rawContext) : null;
    if (!deliveryContextDigest) throw new Error("PREAUTH_CONTEXT_REQUIRED");
    await runtime.service.register({ ...body, deliveryContextDigest });
    return genericAcceptedResponse();
  } catch (error: unknown) {
    console.error(`AUTH_REGISTER_FAILED_${classifyAuthRegisterFailure(error)}`);
    return authUnavailableResponse();
  }
}
