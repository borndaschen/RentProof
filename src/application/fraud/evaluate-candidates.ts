import { evaluateExtendedFraudSignals, type FraudSignalCheck } from "@/domain/fraud";
import { ExtendedFraudCandidateInputSchema } from "./contracts";

/**
 * Validates untrusted extractor/user-confirmation candidates before deterministic evaluation.
 * The extractor cannot provide status, action, reason code, or signal ordering.
 */
export function evaluateValidatedFraudCandidates(input: unknown): readonly FraudSignalCheck[] {
  const parsed = ExtendedFraudCandidateInputSchema.parse(input);
  return evaluateExtendedFraudSignals({
    candidates: parsed.candidates,
    ...(parsed.priorSignalChecks === undefined
      ? {}
      : { priorSignalChecks: parsed.priorSignalChecks }),
  });
}
