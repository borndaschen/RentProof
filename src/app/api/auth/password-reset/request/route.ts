import { getSelfHostedAuthRuntime } from "@/server/auth/runtime";
import {
  ResetRequestBodySchema,
  genericAcceptedResponse,
  guardAuthMutation,
  readPreAuthCookie,
  readBoundedAuthJson,
} from "@/server/auth/http";
import { getServerEnvironment } from "@/server/env";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const environment = getServerEnvironment();
  const blocked = guardAuthMutation(request, environment, "password-reset-request");
  if (blocked) return blocked;
  try {
    const body = ResetRequestBodySchema.parse(await readBoundedAuthJson(request));
    const runtime = await getSelfHostedAuthRuntime();
    const rawContext = readPreAuthCookie(request, environment);
    const deliveryContextDigest = rawContext ? runtime.digestPreAuthContext(rawContext) : null;
    if (deliveryContextDigest) {
      await runtime.service.requestPasswordReset({
        email: body.email,
        deliveryContextDigest,
      });
    }
  } catch {
    // Enumeration-safe response is identical for invalid, missing, and unavailable accounts.
  }
  return genericAcceptedResponse();
}
