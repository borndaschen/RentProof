import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
import {
  CodeBodySchema,
  authUnavailableResponse,
  genericAcceptedResponse,
  guardAuthMutation,
  readBoundedAuthJson,
} from "@/server/auth/http";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  const blocked = guardAuthMutation(request, environment, "verify-registration");
  if (blocked) return blocked;
  let body;
  try {
    body = CodeBodySchema.parse(await readBoundedAuthJson(request));
  } catch {
    return genericAcceptedResponse();
  }
  try {
    await (await getSelfHostedAuthRuntime()).service.verifyEmail(body.code);
  } catch {
    return authUnavailableResponse();
  }
  return genericAcceptedResponse();
}
