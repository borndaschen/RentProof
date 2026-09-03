import { z } from "zod";
import { IsoInstantSchema, OpaqueIdSchema, Sha256Schema } from "./primitives";

export const PendingConfirmationSchema = z
  .object({
    confirmationIdHash: Sha256Schema,
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    caseRevision: z.number().int().nonnegative(),
    candidateType: z.enum(["update_case_profile", "update_fraud_timeline"]),
    canonicalPayloadHash: Sha256Schema,
    createdAt: IsoInstantSchema,
    expiresAt: IsoInstantSchema,
    status: z.enum(["pending", "consumed", "revoked"]),
    consumedAt: IsoInstantSchema.nullable(),
  })
  .strict();

export const ConfirmCandidateCommandSchema = z
  .object({
    confirmationId: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    expectedCaseRevision: z.number().int().nonnegative(),
  })
  .strict();
