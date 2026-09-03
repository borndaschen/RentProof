import { z } from "zod";
import { MaterialCandidatePayloadSchema } from "@/domain/conversation/candidate";
import { OpaqueIdSchema } from "@/domain/conversation/primitives";

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

export const CaseOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("guest"),
      guestId: OpaqueIdSchema,
      guestSessionId: OpaqueIdSchema,
    })
    .strict(),
  z.object({ kind: z.literal("user"), userId: OpaqueIdSchema }).strict(),
]);

const unknownValue = z.object({ status: z.literal("unknown") }).strict();
const known = <T extends z.ZodType>(value: T) =>
  z.object({ status: z.literal("known"), value }).strict();

export const SingleCaseAggregateSchema = z
  .object({
    caseId: OpaqueIdSchema,
    owner: CaseOwnerSchema,
    revision: z.number().int().nonnegative(),
    caseProfile: z
      .object({
        residentialLease: z.union([unknownValue, known(z.enum(["yes", "no"]))]),
        intendedLeaseMonths: z.union([unknownValue, known(z.number().int().min(1).max(120))]),
        plannedSigningDate: z.union([
          unknownValue,
          known(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)),
        ]),
        electricityPayer: z.union([unknownValue, known(z.enum(["tenant", "landlord", "shared"]))]),
      })
      .strict(),
    fraudTimeline: z
      .object({
        paymentRequestedAt: z.union([unknownValue, known(z.iso.datetime({ offset: true }))]),
        firstInPersonViewingAt: z.union([unknownValue, known(z.iso.datetime({ offset: true }))]),
        paymentMade: z.union([unknownValue, known(z.boolean())]),
        lettingAuthorityVerified: z.union([unknownValue, known(z.boolean())]),
      })
      .strict(),
  })
  .strict();

export const ApplyMaterialCandidateCommandSchema = z
  .object({
    actor: ActorContextSchema,
    caseId: OpaqueIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    candidate: MaterialCandidatePayloadSchema,
  })
  .strict();

export type ActorContext = z.infer<typeof ActorContextSchema>;
export type CaseOwner = z.infer<typeof CaseOwnerSchema>;
export type SingleCaseAggregate = z.infer<typeof SingleCaseAggregateSchema>;
export type ApplyMaterialCandidateCommand = z.infer<typeof ApplyMaterialCandidateCommandSchema>;

export function actorOwnsCase(actor: ActorContext, owner: CaseOwner): boolean {
  if (actor.kind !== owner.kind) return false;
  if (actor.kind === "user" && owner.kind === "user") return actor.userId === owner.userId;
  return (
    actor.kind === "guest" &&
    owner.kind === "guest" &&
    actor.guestId === owner.guestId &&
    actor.guestSessionId === owner.guestSessionId
  );
}

export function createEmptySingleCase(
  input: Readonly<{
    caseId: string;
    owner: CaseOwner;
  }>,
): SingleCaseAggregate {
  return SingleCaseAggregateSchema.parse({
    caseId: input.caseId,
    owner: input.owner,
    revision: 0,
    caseProfile: {
      residentialLease: { status: "unknown" },
      intendedLeaseMonths: { status: "unknown" },
      plannedSigningDate: { status: "unknown" },
      electricityPayer: { status: "unknown" },
    },
    fraudTimeline: {
      paymentRequestedAt: { status: "unknown" },
      firstInPersonViewingAt: { status: "unknown" },
      paymentMade: { status: "unknown" },
      lettingAuthorityVerified: { status: "unknown" },
    },
  });
}
