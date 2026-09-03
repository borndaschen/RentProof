import "server-only";
import { cookies } from "next/headers";
import type { ActorContext } from "@/application/repositories";
import { getServerEnvironment } from "@/server/env";
import { readSessionCookie, setSessionCookie } from "./http";
import { getSelfHostedAuthRuntime } from "./runtime";
import { GUEST_SESSION_COOKIE, getGuestSessionRuntime } from "./guest-session";
import { readUniqueCookie } from "./request-guard";

export class CurrentActorResolutionError extends Error {
  override readonly name = "CurrentActorResolutionError";
}

export async function resolveCurrentTransferActors(request: Request): Promise<{
  user: ActorContext & { kind: "user" };
  guest: ActorContext & { kind: "guest" };
  reverified: boolean;
} | null> {
  const environment = getServerEnvironment();
  try {
    const resolution = await (
      await getSelfHostedAuthRuntime()
    ).service.resolveSession(readSessionCookie(request, environment), true);
    if (resolution.status === "signed_out" || resolution.actor.kind !== "user") return null;
    if (!resolution.refreshCookie) throw new CurrentActorResolutionError();
    setSessionCookie(await cookies(), environment, resolution.refreshCookie);
    const rawGuestToken = readUniqueCookie(request.headers.get("cookie"), GUEST_SESSION_COOKIE);
    const guest = await (await getGuestSessionRuntime()).resolve(rawGuestToken ?? undefined);
    return guest ? { user: resolution.actor, guest, reverified: resolution.reverified } : null;
  } catch (error) {
    if (error instanceof CurrentActorResolutionError) throw error;
    throw new CurrentActorResolutionError();
  }
}

export async function resolveCurrentCaseActor(request: Request): Promise<ActorContext | null> {
  const account = await resolveCurrentAccountActor(request, true);
  if (account) return account;
  try {
    const rawGuestToken = readUniqueCookie(request.headers.get("cookie"), GUEST_SESSION_COOKIE);
    return await (await getGuestSessionRuntime()).resolve(rawGuestToken ?? undefined);
  } catch {
    throw new CurrentActorResolutionError();
  }
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
