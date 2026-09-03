import { z } from "zod";
import { CONVERSATION_LIMITS } from "./constants";
import { MaterialCandidatePayloadSchema } from "./candidate";
import { IsoInstantSchema, OpaqueIdSchema, unicodeCodePointLength } from "./primitives";

const CardBaseSchema = z
  .object({
    cardId: OpaqueIdSchema,
    focusRefId: OpaqueIdSchema.nullable(),
    snapshotId: OpaqueIdSchema.nullable(),
    priorityClass: z.enum([
      "blocking_security",
      "stop_and_verify",
      "pending_confirmation",
      "current_next_step",
      "evidence",
    ]),
  })
  .strict();

const SimpleCardSchema = CardBaseSchema.extend({
  cardType: z.enum([
    "upload",
    "finding",
    "evidence_locator",
    "follow_up",
    "report_action",
    "clarification",
    "safety_notice",
    "error",
    "focus_choice",
  ]),
  title: z.string().max(120),
  description: z.string().max(400),
}).strict();

const CandidateConfirmationCardSchema = CardBaseSchema.extend({
  cardType: z.literal("candidate_confirmation"),
  confirmationId: OpaqueIdSchema,
  csrfToken: OpaqueIdSchema,
  candidate: MaterialCandidatePayloadSchema,
  expiresAt: IsoInstantSchema,
  status: z.enum(["pending", "expired", "stale", "used"]),
  primaryAction: z.enum(["confirm_and_add", "regenerate_from_current_state"]),
  canModify: z.literal(true),
}).strict();

export const AssistantCardSchema = z.discriminatedUnion("cardType", [
  SimpleCardSchema,
  CandidateConfirmationCardSchema,
]);

const ServerSegmentSchema = z
  .object({
    kind: z.literal("server_message"),
    templateKey: z.enum([
      "next_step",
      "clarification",
      "validation_error",
      "provider_error",
      "insufficient_information",
      "http_warning",
    ]),
    text: z.string(),
  })
  .strict();

const ExplanationSegmentSchema = z
  .object({
    kind: z.literal("ai_explanation"),
    text: z.string(),
    grounding: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("source_refs"),
          sourceRefIds: z.array(OpaqueIdSchema).min(1).max(5),
        })
        .strict(),
      z
        .object({
          kind: z.literal("insufficient_information"),
          reasonCode: z.enum(["EXPLANATION_FACTS_INSUFFICIENT", "EXPLANATION_LOCATOR_UNAVAILABLE"]),
        })
        .strict(),
    ]),
  })
  .strict();

export const AssistantTurnSchema = z
  .object({
    schemaVersion: z.literal("rentproof.assistant-turn.v1"),
    turnId: OpaqueIdSchema,
    caseRevision: z.number().int().nonnegative(),
    snapshotId: OpaqueIdSchema.nullable(),
    segments: z
      .array(z.discriminatedUnion("kind", [ServerSegmentSchema, ExplanationSegmentSchema]))
      .max(6),
    cards: z.array(AssistantCardSchema).max(CONVERSATION_LIMITS.assistantCards),
    remainingItemCount: z.number().int().nonnegative(),
    workspaceAction: z
      .object({
        area: z.enum(["summary", "evidence_matrix", "contract", "report"]),
        labelKey: z.literal("view_evidence_workspace"),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((turn, context) => {
    const narrative = turn.segments.map((segment) => segment.text).join("");
    if (unicodeCodePointLength(narrative) > CONVERSATION_LIMITS.assistantNarrativeCodePoints) {
      context.addIssue({ code: "custom", message: "ASSISTANT_NARRATIVE_TOO_LONG" });
    }
    if (turn.remainingItemCount > 0 && turn.workspaceAction === null) {
      context.addIssue({ code: "custom", message: "WORKSPACE_ACTION_REQUIRED" });
    }
  });

export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;
