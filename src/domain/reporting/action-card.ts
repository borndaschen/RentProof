import { z } from "zod";

export const ReportActionTypeSchema = z.enum(["ask", "photograph", "modify", "attach", "verify"]);
export const ReportActionReasonClassSchema = z.enum([
  "payment_verification",
  "explicit_contradiction",
  "official_rule_possible_difference",
  "missing_verification_information",
  "insufficient_evidence",
]);

export const ReportActionTargetSchema = z
  .object({
    kind: z.enum(["finding", "rule_check", "fraud_signal"]),
    refId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
  })
  .strict();

export const CompletionConditionSchema = z.enum([
  "written_answer_recorded",
  "requested_photos_attached_and_located",
  "contract_or_confirmation_updated_and_attached",
  "requested_document_attached_and_verified",
  "payment_request_verified_before_payment",
]);

export const ActionCardDraftSchema = z
  .object({
    actionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    actionType: ReportActionTypeSchema,
    reasonClass: ReportActionReasonClassSchema,
    target: ReportActionTargetSchema,
    sourceRefs: z.array(z.string().min(1).max(128)).min(1).max(20),
    completionConditions: z.array(CompletionConditionSchema).min(1).max(5),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,95}$/u),
  })
  .strict();

export const ActionCardSchema = ActionCardDraftSchema.omit({ reasonClass: true })
  .extend({ priority: z.number().int().nonnegative() })
  .strict();

export type ActionCardDraft = z.infer<typeof ActionCardDraftSchema>;
export type ActionCard = z.infer<typeof ActionCardSchema>;
export type ReportActionType = z.infer<typeof ReportActionTypeSchema>;
export type ReportActionReasonClass = z.infer<typeof ReportActionReasonClassSchema>;

const priorityByReason: Readonly<Record<ReportActionReasonClass, number>> = {
  payment_verification: 0,
  explicit_contradiction: 10,
  official_rule_possible_difference: 20,
  missing_verification_information: 25,
  insufficient_evidence: 30,
};

export function composeActionCards(input: unknown): ActionCard[] {
  const drafts = z.array(ActionCardDraftSchema).parse(input);
  return drafts
    .map(({ reasonClass, ...draft }) =>
      ActionCardSchema.parse({ ...draft, priority: priorityByReason[reasonClass] }),
    )
    .sort(
      (left, right) =>
        left.priority - right.priority || left.actionId.localeCompare(right.actionId),
    );
}
