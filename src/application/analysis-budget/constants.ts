export const EVIDENCE_BUDGET_LIMITS = Object.freeze({
  providerAttempts: 16,
  concurrency: 2,
  inputTokens: 500_000,
  outputAndReasoningTokens: 50_000,
  engineeringAlertNanoUsd: 2_000_000_000n,
} as const);

export const TERRA_STANDARD_RATES_NANO_USD = Object.freeze({
  uncachedInputPerToken: 2_000n,
  cachedInputPerToken: 200n,
  outputPerToken: 12_000n,
} as const);
