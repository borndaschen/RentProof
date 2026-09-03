export const CONVERSATION_BUDGET_LIMITS = Object.freeze({
  windowMs: 24 * 60 * 60 * 1_000,
  providerAttempts: 200,
  inputTokens: 500_000,
  outputAndReasoningTokens: 100_000,
} as const);
