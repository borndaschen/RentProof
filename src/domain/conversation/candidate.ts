import { z } from "zod";
import { IsoDateSchema, IsoInstantSchema, OpaqueIdSchema, Sha256Schema } from "./primitives";

const UnknownValueSchema = z.object({ status: z.literal("unknown") }).strict();
const known = <T extends z.ZodType>(value: T) =>
  z.object({ status: z.literal("known"), value }).strict();

const CaseProfileChangeSchema = z.discriminatedUnion("field", [
  z
    .object({
      field: z.literal("residential_lease"),
      value: z.union([UnknownValueSchema, known(z.enum(["yes", "no"]))]),
    })
    .strict(),
  z
    .object({
      field: z.literal("intended_lease_months"),
      value: z.union([UnknownValueSchema, known(z.number().int().min(1).max(120))]),
    })
    .strict(),
  z
    .object({
      field: z.literal("planned_signing_date"),
      value: z.union([UnknownValueSchema, known(IsoDateSchema)]),
    })
    .strict(),
  z
    .object({
      field: z.literal("electricity_payer"),
      value: z.union([UnknownValueSchema, known(z.enum(["tenant", "landlord", "shared"]))]),
    })
    .strict(),
]);

const FraudTimelineChangeSchema = z.discriminatedUnion("field", [
  z
    .object({
      field: z.literal("payment_requested_at"),
      value: z.union([UnknownValueSchema, known(IsoInstantSchema)]),
    })
    .strict(),
  z
    .object({
      field: z.literal("first_in_person_viewing_at"),
      value: z.union([UnknownValueSchema, known(IsoInstantSchema)]),
    })
    .strict(),
  z
    .object({
      field: z.literal("payment_made"),
      value: z.union([UnknownValueSchema, known(z.boolean())]),
    })
    .strict(),
  z
    .object({
      field: z.literal("letting_authority_verified"),
      value: z.union([UnknownValueSchema, known(z.boolean())]),
    })
    .strict(),
]);

export const MaterialCandidatePayloadSchema = z
  .discriminatedUnion("candidateType", [
    z
      .object({
        candidateType: z.literal("update_case_profile"),
        changes: z.array(CaseProfileChangeSchema).min(1).max(4),
      })
      .strict(),
    z
      .object({
        candidateType: z.literal("update_fraud_timeline"),
        changes: z.array(FraudTimelineChangeSchema).min(1).max(4),
      })
      .strict(),
  ])
  .superRefine((candidate, context) => {
    const fields = candidate.changes.map((change) => change.field);
    if (new Set(fields).size !== fields.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_CANDIDATE_FIELD" });
    }
  });

export const MaterialCandidateEnvelopeSchema = z
  .object({
    candidateId: OpaqueIdSchema,
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    caseRevision: z.number().int().nonnegative(),
    source: z.object({ kind: z.literal("conversation_turn"), turnId: OpaqueIdSchema }).strict(),
    payload: MaterialCandidatePayloadSchema,
    canonicalPayloadHash: Sha256Schema,
    createdAt: IsoInstantSchema,
  })
  .strict();

export type MaterialCandidatePayload = z.infer<typeof MaterialCandidatePayloadSchema>;
