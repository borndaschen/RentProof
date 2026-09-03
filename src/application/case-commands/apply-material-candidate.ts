import { ApplyMaterialCandidateCommandSchema, SingleCaseAggregateSchema } from "./contracts";
import type { SingleCaseAggregate } from "./contracts";
import { actorOwnsCase } from "./contracts";
import type { SingleCaseRepository } from "./ports";

export type ApplyMaterialCandidateResult =
  | Readonly<{ ok: true; aggregate: SingleCaseAggregate }>
  | Readonly<{
      ok: false;
      code: "CASE_NOT_FOUND_OR_FORBIDDEN" | "CASE_REVISION_CHANGED" | "CASE_REPOSITORY_FAILED";
    }>;

export class ApplyMaterialCandidateUseCase {
  constructor(private readonly repository: SingleCaseRepository) {}

  async execute(untrustedCommand: unknown): Promise<ApplyMaterialCandidateResult> {
    const command = ApplyMaterialCandidateCommandSchema.parse(untrustedCommand);
    const current = await this.repository.load(command.caseId);
    if (current === null || !actorOwnsCase(command.actor, current.owner)) {
      return { ok: false, code: "CASE_NOT_FOUND_OR_FORBIDDEN" };
    }
    if (current.revision !== command.expectedRevision) {
      return { ok: false, code: "CASE_REVISION_CHANGED" };
    }

    const next = structuredClone(current);
    if (command.candidate.candidateType === "update_case_profile") {
      for (const change of command.candidate.changes) {
        switch (change.field) {
          case "residential_lease":
            next.caseProfile.residentialLease = change.value;
            break;
          case "intended_lease_months":
            next.caseProfile.intendedLeaseMonths = change.value;
            break;
          case "planned_signing_date":
            next.caseProfile.plannedSigningDate = change.value;
            break;
          case "electricity_payer":
            next.caseProfile.electricityPayer = change.value;
            break;
        }
      }
    } else {
      for (const change of command.candidate.changes) {
        switch (change.field) {
          case "payment_requested_at":
            next.fraudTimeline.paymentRequestedAt = change.value;
            break;
          case "first_in_person_viewing_at":
            next.fraudTimeline.firstInPersonViewingAt = change.value;
            break;
          case "payment_made":
            next.fraudTimeline.paymentMade = change.value;
            break;
          case "letting_authority_verified":
            next.fraudTimeline.lettingAuthorityVerified = change.value;
            break;
        }
      }
    }
    next.revision += 1;
    const validated = SingleCaseAggregateSchema.parse(next);
    const saved = await this.repository.saveAtomic(validated, current.revision);
    if (saved === "revision_conflict") return { ok: false, code: "CASE_REVISION_CHANGED" };
    if (saved === "failed") return { ok: false, code: "CASE_REPOSITORY_FAILED" };
    return { ok: true, aggregate: validated };
  }
}
