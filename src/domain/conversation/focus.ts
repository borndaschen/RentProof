import { z } from "zod";
import { NormalizedTurnSchema, OpaqueIdSchema } from "./primitives";

export const ServerConversationStateSchema = z
  .object({
    schemaVersion: z.literal("rentproof.server-conversation-state.v1"),
    casePhase: z.enum([
      "case_setup",
      "listing",
      "viewing",
      "evidence",
      "contract",
      "fraud_check",
      "follow_up",
      "report_ready",
    ]),
    caseRevision: z.number().int().nonnegative(),
    snapshotId: OpaqueIdSchema.nullable(),
    executionMode: z.enum(["fixture", "live"]),
    availableActions: z
      .array(
        z.enum([
          "show_next_step",
          "show_case_summary",
          "open_workspace",
          "explain_focus",
          "show_source",
          "update_case_profile",
          "update_fraud_timeline",
        ]),
      )
      .max(12),
    pendingCandidateTypes: z.array(z.enum(["update_case_profile", "update_fraud_timeline"])).max(3),
    knownFields: z
      .object({
        residentialLease: z.boolean(),
        intendedLeaseMonths: z.boolean(),
        plannedSigningDate: z.boolean(),
        electricityPayer: z.boolean(),
        paymentRequestedAt: z.boolean(),
        firstInPersonViewingAt: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const ValidatedFocusRefSchema = z
  .object({
    focusRefId: OpaqueIdSchema,
    kind: z.enum([
      "assistant_card",
      "finding",
      "claim",
      "contract_clause",
      "action",
      "source_locator",
    ]),
    snapshotId: OpaqueIdSchema,
    label: z.string().max(120),
    verifiedSummary: z.string().max(400),
    sourceRefIds: z.array(OpaqueIdSchema).max(5),
  })
  .strict();

export const ConversationIntentInputSchema = z
  .object({
    currentTurn: NormalizedTurnSchema,
    state: ServerConversationStateSchema,
    focusRefs: z.array(ValidatedFocusRefSchema).max(3),
  })
  .strict();
