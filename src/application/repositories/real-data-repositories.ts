import { z } from "zod";
import { OpaqueIdSchema } from "@/domain/conversation";
import type { ActorContext } from "./actor-context";

const IsoTimestampSchema = z.iso.datetime({ offset: true });

export const PolicyEventInputSchema = z
  .object({
    eventId: OpaqueIdSchema,
    policyDocumentId: OpaqueIdSchema,
    eventType: z.enum(["accepted", "acknowledged", "consented", "declined", "withdrawn"]),
    occurredAt: IsoTimestampSchema,
    sourceRoute: z.string().startsWith("/").max(200),
    caseId: OpaqueIdSchema.optional(),
    analysisRunId: OpaqueIdSchema.optional(),
    processorListVersion: z.string().min(1).max(80).optional(),
    auditRef: OpaqueIdSchema,
  })
  .strict();

export type PolicyEventInput = z.infer<typeof PolicyEventInputSchema>;

export const ConsentPreferenceInputSchema = z
  .object({
    purposeKey: z.enum(["functional", "analytics", "marketing"]),
    decision: z.enum(["granted", "declined", "withdrawn"]),
    cookiePolicyVersion: z.string().min(1).max(80),
    inventoryVersion: z.string().min(1).max(80),
    occurredAt: IsoTimestampSchema,
  })
  .strict();

export type ConsentPreferenceInput = z.infer<typeof ConsentPreferenceInputSchema>;

export interface PolicyRecordRepository {
  appendPolicyEvent(actor: ActorContext, input: PolicyEventInput): Promise<void>;
  saveConsentPreference(actor: ActorContext, input: ConsentPreferenceInput): Promise<void>;
}

export const DeletionRequestInputSchema = z
  .object({
    deletionRequestId: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    requestedAt: IsoTimestampSchema,
    purgeDeadline: IsoTimestampSchema,
    correlationId: OpaqueIdSchema,
  })
  .strict();

export type DeletionRequestInput = z.infer<typeof DeletionRequestInputSchema>;

export type RequestCaseDeletionResult =
  { status: "accepted" } | { status: "not_found_or_forbidden" } | { status: "already_pending" };

export interface DeletionRepository {
  requestCaseDeletion(
    actor: ActorContext,
    input: DeletionRequestInput,
  ): Promise<RequestCaseDeletionResult>;
}

export const SecurityAuditEventInputSchema = z
  .object({
    eventId: OpaqueIdSchema,
    eventType: z.enum([
      "authorization_denied",
      "authentication_failed",
      "deletion_requested",
      "deletion_completed",
      "policy_recorded",
      "security_gate_failed",
    ]),
    occurredAt: IsoTimestampSchema,
    outcome: z.enum(["success", "failure"]),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
    correlationId: OpaqueIdSchema,
    actorRef: OpaqueIdSchema.optional(),
    targetRef: OpaqueIdSchema.optional(),
    providerRef: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,128}$/u)
      .optional(),
  })
  .strict();

export type SecurityAuditEventInput = z.infer<typeof SecurityAuditEventInputSchema>;

export interface SecurityAuditRepository {
  appendSecurityEvent(input: SecurityAuditEventInput): Promise<void>;
}
