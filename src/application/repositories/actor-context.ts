import { z } from "zod";
import { OpaqueIdSchema } from "@/domain/conversation";

export const ActorContextSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("guest"),
      guestId: OpaqueIdSchema,
      guestSessionId: OpaqueIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("user"),
      userId: OpaqueIdSchema,
      sessionId: OpaqueIdSchema,
    })
    .strict(),
]);

export type ActorContext = z.infer<typeof ActorContextSchema>;

export const CaseOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("guest"),
      guestId: OpaqueIdSchema,
      guestSessionId: OpaqueIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("user"),
      userId: OpaqueIdSchema,
    })
    .strict(),
]);

export type CaseOwner = z.infer<typeof CaseOwnerSchema>;

export function ownerFromActor(actor: ActorContext): CaseOwner {
  return actor.kind === "guest"
    ? { kind: "guest", guestId: actor.guestId, guestSessionId: actor.guestSessionId }
    : { kind: "user", userId: actor.userId };
}

export function actorOwnsCase(actor: ActorContext, owner: CaseOwner): boolean {
  if (actor.kind !== owner.kind) {
    return false;
  }
  if (actor.kind === "guest" && owner.kind === "guest") {
    return actor.guestId === owner.guestId && actor.guestSessionId === owner.guestSessionId;
  }
  return actor.kind === "user" && owner.kind === "user" && actor.userId === owner.userId;
}
