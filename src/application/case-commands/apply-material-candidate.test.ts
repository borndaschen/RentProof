import { describe, expect, it } from "vitest";
import { ApplyMaterialCandidateUseCase } from "./apply-material-candidate";
import { createEmptySingleCase } from "./contracts";
import { InMemorySingleCaseRepository } from "./in-memory-single-case-repository";

const caseId = "case_commands_opaque_00001";
const guestActor = {
  kind: "guest" as const,
  guestId: "guest_commands_opaque_001",
  guestSessionId: "guest_session_commands_01",
};

function setup() {
  const repository = new InMemorySingleCaseRepository(
    createEmptySingleCase({
      caseId,
      owner: {
        kind: "guest",
        guestId: guestActor.guestId,
        guestSessionId: guestActor.guestSessionId,
      },
    }),
  );
  return { repository, useCase: new ApplyMaterialCandidateUseCase(repository) };
}

describe("ApplyMaterialCandidateUseCase", () => {
  it("applies typed profile and fraud timeline changes with revision CAS", async () => {
    const { repository, useCase } = setup();
    const profile = await useCase.execute({
      actor: guestActor,
      caseId,
      expectedRevision: 0,
      candidate: {
        candidateType: "update_case_profile",
        changes: [
          {
            field: "residential_lease",
            value: { status: "known", value: "yes" },
          },
          {
            field: "intended_lease_months",
            value: { status: "known", value: 12 },
          },
          {
            field: "planned_signing_date",
            value: { status: "known", value: "2026-09-20" },
          },
          {
            field: "electricity_payer",
            value: { status: "known", value: "tenant" },
          },
        ],
      },
    });
    expect(profile).toMatchObject({
      ok: true,
      aggregate: {
        revision: 1,
        caseProfile: {
          electricityPayer: { status: "known", value: "tenant" },
        },
      },
    });

    const fraud = await useCase.execute({
      actor: guestActor,
      caseId,
      expectedRevision: 1,
      candidate: {
        candidateType: "update_fraud_timeline",
        changes: [
          {
            field: "payment_requested_at",
            value: { status: "known", value: "2026-09-01T03:00:00.000Z" },
          },
          {
            field: "first_in_person_viewing_at",
            value: { status: "known", value: "2026-09-02T03:00:00.000Z" },
          },
          {
            field: "payment_made",
            value: { status: "known", value: false },
          },
          {
            field: "letting_authority_verified",
            value: { status: "known", value: false },
          },
        ],
      },
    });
    expect(fraud).toMatchObject({
      ok: true,
      aggregate: {
        revision: 2,
        fraudTimeline: { paymentMade: { status: "known", value: false } },
      },
    });
    expect((await repository.load(caseId))?.revision).toBe(2);
  });

  it("rejects wrong owners and stale revisions without changing state", async () => {
    const { repository, useCase } = setup();
    const candidate = {
      candidateType: "update_case_profile" as const,
      changes: [
        {
          field: "electricity_payer" as const,
          value: { status: "known" as const, value: "tenant" as const },
        },
      ],
    };
    await expect(
      useCase.execute({
        actor: { ...guestActor, guestSessionId: "different_guest_session_01" },
        caseId,
        expectedRevision: 0,
        candidate,
      }),
    ).resolves.toEqual({ ok: false, code: "CASE_NOT_FOUND_OR_FORBIDDEN" });
    await expect(
      useCase.execute({
        actor: {
          kind: "user",
          userId: "different_user_commands_01",
          sessionId: "different_session_commands1",
        },
        caseId,
        expectedRevision: 0,
        candidate,
      }),
    ).resolves.toEqual({ ok: false, code: "CASE_NOT_FOUND_OR_FORBIDDEN" });
    await expect(
      useCase.execute({
        actor: guestActor,
        caseId,
        expectedRevision: 1,
        candidate,
      }),
    ).resolves.toEqual({ ok: false, code: "CASE_REVISION_CHANGED" });
    expect((await repository.load(caseId))?.revision).toBe(0);
  });

  it("maps repository conflict and failure without mutating the aggregate", async () => {
    const { repository, useCase } = setup();
    const command = {
      actor: guestActor,
      caseId,
      expectedRevision: 0,
      candidate: {
        candidateType: "update_case_profile" as const,
        changes: [
          {
            field: "electricity_payer" as const,
            value: { status: "known" as const, value: "tenant" as const },
          },
        ],
      },
    };
    repository.failNextSave("revision_conflict");
    await expect(useCase.execute(command)).resolves.toEqual({
      ok: false,
      code: "CASE_REVISION_CHANGED",
    });
    repository.failNextSave("failed");
    await expect(useCase.execute(command)).resolves.toEqual({
      ok: false,
      code: "CASE_REPOSITORY_FAILED",
    });
    expect(await repository.load(caseId)).toMatchObject({
      revision: 0,
      caseProfile: { electricityPayer: { status: "unknown" } },
    });
  });

  it("enforces repository CAS and returns null for another case", async () => {
    const { repository } = setup();
    const current = await repository.load(caseId);
    if (current === null) throw new Error("CASE_FIXTURE_MISSING");
    await expect(repository.saveAtomic({ ...current, revision: 1 }, 1)).resolves.toBe(
      "revision_conflict",
    );
    await expect(repository.load("other_case_commands_001")).resolves.toBeNull();
  });
});
