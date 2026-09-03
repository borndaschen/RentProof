import "server-only";
import { cookies } from "next/headers";
import type { ActorContext } from "@/application/repositories";
import { getServerEnvironment } from "@/server/env";
import { readSessionCookie, setSessionCookie } from "./http";
import { getSelfHostedAuthRuntime } from "./runtime";

export class CurrentActorResolutionError extends Error {
  override readonly name = "CurrentActorResolutionError";
}

export async function resolveCurrentAccountActor(
  request: Request,
  touch: boolean,
): Promise<(ActorContext & { kind: "user" }) | null> {
  const environment = getServerEnvironment();
  try {
    const resolution = await (
      await getSelfHostedAuthRuntime()
    ).service.resolveSession(readSessionCookie(request, environment), touch);
    if (resolution.status === "signed_out") return null;
    if (resolution.actor.kind !== "user") throw new CurrentActorResolutionError();
    if (touch) {
      if (!resolution.refreshCookie) throw new CurrentActorResolutionError();
      setSessionCookie(await cookies(), environment, resolution.refreshCookie);
    }
    return resolution.actor;
  } catch (error) {
    if (error instanceof CurrentActorResolutionError) throw error;
    throw new CurrentActorResolutionError();
  }
}
