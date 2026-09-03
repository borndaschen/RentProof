import { describe, expect, it } from "vitest";
import {
  ApplyMaterialCandidateUseCase,
  createEmptySingleCase,
  InMemorySingleCaseRepository,
} from "@/application/case-commands";
import type { ActorContext } from "@/application/case-commands";
import { MaterialConfirmationService } from "./material-confirmation-service";
import type {
  MaterialConfirmationClock,
  MaterialConfirmationIdGenerator,
} from "./material-confirmation-service";

const caseId = "case_confirmation_opaque_01";
const otherCaseId = "other_case_confirmation_001";
const guestActor = {
  kind: "guest" as const,
  guestId: "guest_confirmation_opaque1",
  guestSessionId: "guest_session_confirm_0001",
};
const userActor = {
  kind: "user" as const,
  userId: "user_confirmation_opaque_1",
  sessionId: "user_session_confirm_0001",
};
const electricityCandidate = {
  candidateType: "update_case_profile" as const,
  changes: [
    {
      field: "electricity_payer" as const,
      value: { status: "known" as const, value: "tenant" as const },
    },
  ],
};

class MutableClock implements MaterialConfirmationClock {
  #value = new Date("2026-09-02T09:00:00.000Z");

  now(): Date {
    return new Date(this.#value);
  }

  set(value: string): void {
    this.#value = new Date(value);
  }
}

class SequentialIds implements MaterialConfirmationIdGenerator {
  #value = 0;

  nextId(): string {
    this.#value += 1;
    return `confirmation_server_${String(this.#value).padStart(8, "0")}`;
  }
}

function setup(
  owner: "guest" | "user" = "guest",
  idGenerator: MaterialConfirmationIdGenerator = new SequentialIds(),
) {
  const aggregate = createEmptySingleCase({
    caseId,
    owner:
      owner === "guest"
        ? {
            kind: "guest",
            guestId: guestActor.guestId,
            guestSessionId: guestActor.guestSessionId,
          }
        : { kind: "user", userId: userActor.userId },
  });
  const repository = new InMemorySingleCaseRepository(aggregate);
  const useCase = new ApplyMaterialCandidateUseCase(repository);
  const clock = new MutableClock();
  const service = new MaterialConfirmationService({
    repository,
    applyCandidate: useCase,
    clock,
    idGenerator,
  });
  return { service, repository, useCase, clock };
}

async function issue(service: MaterialConfirmationService, actor: ActorContext = guestActor) {
  const result = await service.issue({ actor, caseId, candidate: electricityCandidate });
  if (!result.ok) throw new Error(result.code);
  return result;
}

describe("MaterialConfirmationService", () => {
  it.each([
    ["guest", guestActor],
    ["user", userActor],
  ] as const)(
    "issues and consumes a %s-owned confirmation, then increments revision",
    async (owner, actor) => {
      const { service, repository } = setup(owner);
      const issued = await issue(service, actor);
      expect(issued).toMatchObject({
        caseRevision: 0,
        expiresAt: "2026-09-02T09:10:00.000Z",
        candidate: electricityCandidate,
      });
      await expect(
        service.consume({ confirmationId: issued.confirmationId, actor, caseId }),
      ).resolves.toEqual({ ok: true, revision: 1 });
      expect(await repository.load(caseId)).toMatchObject({
        revision: 1,
        caseProfile: { electricityPayer: { status: "known", value: "tenant" } },
      });
    },
  );

  it("binds confirmation to actor and case without consuming on a mismatch", async () => {
    const { service } = setup();
    const issued = await issue(service);
    await expect(
      service.consume({
        confirmationId: issued.confirmationId,
        actor: { ...guestActor, guestSessionId: "different_guest_session_01" },
        caseId,
      }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_ACTOR_MISMATCH" });
    await expect(
      service.consume({
        confirmationId: issued.confirmationId,
        actor: guestActor,
        caseId: otherCaseId,
      }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_STALE" });
    await expect(
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
    ).resolves.toEqual({ ok: true, revision: 1 });
  });

  it("is one-time and atomically rejects replay", async () => {
    const { service } = setup();
    const issued = await issue(service);
    const results = await Promise.all([
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "CONFIRMATION_ALREADY_USED" },
    ]);
  });

  it("expires at ten minutes without changing case state", async () => {
    const { service, repository, clock } = setup();
    const issued = await issue(service);
    clock.set("2026-09-02T09:10:00.000Z");
    await expect(
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_EXPIRED" });
    expect((await repository.load(caseId))?.revision).toBe(0);
  });

  it("does not trust a client-tampered candidate or accept expected payload on consume", async () => {
    const { service, repository } = setup();
    const issued = await issue(service);
    const returnedCandidate = issued.candidate;
    if (returnedCandidate.candidateType !== "update_case_profile") {
      throw new Error("UNEXPECTED_FIXTURE_CANDIDATE");
    }
    returnedCandidate.changes[0] = {
      field: "electricity_payer",
      value: { status: "known", value: "landlord" },
    };

    await expect(
      service.consume({
        confirmationId: issued.confirmationId,
        actor: guestActor,
        caseId,
        expectedCandidate: returnedCandidate,
      }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_REQUEST_INVALID" });
    await expect(
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
    ).resolves.toEqual({ ok: true, revision: 1 });
    expect(await repository.load(caseId)).toMatchObject({
      caseProfile: { electricityPayer: { status: "known", value: "tenant" } },
    });
  });

  it("consumes stale revision races without overwriting newer state", async () => {
    const { service, useCase, repository } = setup();
    const issued = await issue(service);
    await useCase.execute({
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
        ],
      },
    });
    await expect(
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_STALE" });
    expect(await repository.load(caseId)).toMatchObject({
      revision: 1,
      caseProfile: {
        residentialLease: { status: "known", value: "yes" },
        electricityPayer: { status: "unknown" },
      },
    });
    await expect(
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_ALREADY_USED" });
  });

  it("does not mutate state when the repository fails and does not replay", async () => {
    const { service, repository } = setup();
    const issued = await issue(service);
    repository.failNextSave("failed");
    await expect(
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
    ).resolves.toEqual({ ok: false, code: "CASE_REPOSITORY_FAILED" });
    expect((await repository.load(caseId))?.revision).toBe(0);
    await expect(
      service.consume({ confirmationId: issued.confirmationId, actor: guestActor, caseId }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_ALREADY_USED" });
  });

  it("rejects unknown confirmation IDs and non-owners at issue", async () => {
    const { service } = setup();
    await expect(
      service.consume({
        confirmationId: "unknown_confirmation_0001",
        actor: guestActor,
        caseId,
      }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_NOT_FOUND" });
    await expect(
      service.issue({
        actor: { ...guestActor, guestId: "different_guest_confirm_01" },
        caseId,
        candidate: electricityCandidate,
      }),
    ).resolves.toEqual({ ok: false, code: "CASE_NOT_FOUND_OR_FORBIDDEN" });
  });

  it("rejects invalid issue payloads and duplicate server IDs", async () => {
    const fixedId = {
      nextId: () => "confirmation_server_fixed_01",
    } satisfies MaterialConfirmationIdGenerator;
    const { service } = setup("guest", fixedId);
    await expect(
      service.issue({
        actor: guestActor,
        caseId,
        candidate: electricityCandidate,
        clientRevision: 99,
      }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_REQUEST_INVALID" });
    await expect(
      service.issue({ actor: guestActor, caseId, candidate: electricityCandidate }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      service.issue({ actor: guestActor, caseId, candidate: electricityCandidate }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_ID_CONFLICT" });
  });
});
