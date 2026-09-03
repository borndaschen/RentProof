export type ConversationBudgetErrorCode =
  | "CONVERSATION_BUDGET_EXCEEDED"
  | "CONVERSATION_USAGE_UNKNOWN"
  | "CONVERSATION_BUDGET_RESERVATION_CONFLICT"
  | "CONVERSATION_BUDGET_RESERVATION_NOT_FOUND"
  | "CONVERSATION_BUDGET_RESERVATION_ALREADY_RECONCILED"
  | "CONVERSATION_BUDGET_INVALID_USAGE";

export type ConversationBudgetDimension =
  "provider_attempts" | "input_tokens" | "output_and_reasoning_tokens";
