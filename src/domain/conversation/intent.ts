import { z } from "zod";
import { MaterialCandidatePayloadSchema } from "./candidate";
import { OpaqueIdSchema } from "./primitives";

export const ConversationIntentResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("read_only_intent"),
      intent: z.enum([
        "show_next_step",
        "show_case_summary",
        "open_workspace",
        "explain_focus",
        "show_source",
      ]),
      workspaceArea: z.enum(["summary", "evidence_matrix", "contract", "report"]).nullable(),
      focusRefIds: z.array(OpaqueIdSchema).max(3),
    })
    .strict(),
  z
    .object({ kind: z.literal("material_candidate"), candidate: MaterialCandidatePayloadSchema })
    .strict(),
  z
    .object({
      kind: z.literal("clarification_needed"),
      reason: z.enum([
        "intent_ambiguous",
        "focus_required",
        "missing_required_value",
        "multiple_possible_targets",
      ]),
      questionKey: z.enum([
        "clarify_intent",
        "choose_focus",
        "provide_payment_time",
        "provide_viewing_time",
        "confirm_unknown_value",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rejected"),
      reason: z.enum([
        "unsupported_action",
        "unsafe_instruction",
        "attempted_stage_control",
        "attempted_external_access",
      ]),
    })
    .strict(),
]);

export type ConversationIntentResult = z.infer<typeof ConversationIntentResultSchema>;
