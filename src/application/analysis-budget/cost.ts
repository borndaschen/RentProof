import { TERRA_STANDARD_RATES_NANO_USD } from "./constants";

export type TerraTokenUsageForCost = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputAndReasoningTokens: number;
}>;

export function calculateTerraCostNanoUsd(usage: TerraTokenUsageForCost): bigint {
  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  if (
    !Number.isSafeInteger(usage.inputTokens) ||
    !Number.isSafeInteger(usage.cachedInputTokens) ||
    !Number.isSafeInteger(usage.outputAndReasoningTokens) ||
    uncachedInputTokens < 0 ||
    usage.cachedInputTokens < 0 ||
    usage.outputAndReasoningTokens < 0
  ) {
    throw new TypeError("INVALID_TERRA_TOKEN_USAGE");
  }

  return (
    BigInt(uncachedInputTokens) * TERRA_STANDARD_RATES_NANO_USD.uncachedInputPerToken +
    BigInt(usage.cachedInputTokens) * TERRA_STANDARD_RATES_NANO_USD.cachedInputPerToken +
    BigInt(usage.outputAndReasoningTokens) * TERRA_STANDARD_RATES_NANO_USD.outputPerToken
  );
}

export function formatNanoUsd(nanoUsd: bigint): string {
  if (nanoUsd < 0n) throw new TypeError("NEGATIVE_COST_NOT_ALLOWED");
  const whole = nanoUsd / 1_000_000_000n;
  const fraction = (nanoUsd % 1_000_000_000n).toString().padStart(9, "0");
  return `${whole}.${fraction}`;
}
