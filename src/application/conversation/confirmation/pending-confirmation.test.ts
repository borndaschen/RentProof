import { describe, expect, it } from "vitest";
import { canonicalizeCandidatePayload } from "./canonical-payload";
import { consumePendingConfirmation } from "./consume-pending-confirmation";
import { createPendingConfirmation } from "./create-pending-confirmation";
import { PendingConfirmationIntegrityError } from "./errors";
import { InMemoryPendingConfirmationRepository } from "./in-memory-pending-confirmation-repository";
import type { PendingConfirmationEntry } from "./ports";

const confirmationId = "confirmation_opaque_0001";
const actorRef = "actor_opaque_identifier_0001";
const otherActorRef = "actor_opaque_identifier_0002";
const caseId = "case_opaque_identifier_00001";
const otherCaseId = "case_opaque_identifier_00002";
const createdAt = new Date("2026-09-02T04:00:00.000Z");

const profileCandidate = {
  candidateType: "update_case_profile" as const,
  changes: [
    {
      field: "electricity_payer" as const,
      value: { status: "known" as const, value: "tenant" as const },
    },
  ],
};

const changedProfileCandidate = {
  candidateType: "update_case_profile" as const,
  changes: [
    {
      field: "electricity_payer" as const,
      value: { status: "known" as const, value: "landlord" as const },
    },
  ],
};

const fraudCandidate = {
  candidateType: "update_fraud_timeline" as const,
  changes: [
    {
      field: "payment_made" as const,
      value: { status: "known" as const, value: false },
    },
  ],
};

function makeEntry(): PendingConfirmationEntry {
  return createPendingConfirmation({
    confirmationId,
    actorRef,
    caseId,
    caseRevision: 4,
    candidate: profileCandidate,
    now: createdAt,
  });
}

function consumeAt(
  repository: InMemoryPendingConfirmationRepository,
  overrides: Partial<{
    actorRef: string;
    caseId: string;
    currentCaseRevision: number;
    serverExpectedCandidate: unknown;
    now: Date;
  }> = {},
) {
  return consumePendingConfirmation(repository, {
    confirmationId,
    actorRef: overrides.actorRef ?? actorRef,
    caseId: overrides.caseId ?? caseId,
    currentCaseRevision: overrides.currentCaseRevision ?? 4,
    serverExpectedCandidate: overrides.serverExpectedCandidate ?? profileCandidate,
    now: overrides.now ?? new Date("2026-09-02T04:09:59.999Z"),
  });
}

async function repositoryWithEntry(): Promise<InMemoryPendingConfirmationRepository> {
  const repository = new InMemoryPendingConfirmationRepository();
  expect(await repository.insert(makeEntry())).toBe("inserted");
  return repository;
}

describe("pending confirmations", () => {
  it("creates a pending record bound to actor, case, revision, type, hash, and ten minutes", () => {
    const entry = makeEntry();
    const canonical = canonicalizeCandidatePayload(profileCandidate);

    expect(entry.record).toMatchObject({
      actorRef,
      caseId,
      caseRevision: 4,
      candidateType: "update_case_profile",
      canonicalPayloadHash: canonical.sha256,
      createdAt: "2026-09-02T04:00:00.000Z",
      expiresAt: "2026-09-02T04:10:00.000Z",
      status: "pending",
      consumedAt: null,
    });
    expect(entry.record.confirmationIdHash).not.toContain(confirmationId);
  });

  it("consumes once and returns the server-stored typed candidate", async () => {
    const repository = await repositoryWithEntry();
    const first = await consumeAt(repository);

    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.entry.record.status).toBe("consumed");
      expect(first.entry.record.consumedAt).toBe("2026-09-02T04:09:59.999Z");
      expect(first.entry.candidate).toEqual(profileCandidate);
    }

    await expect(consumeAt(repository)).resolves.toEqual({
      ok: false,
      code: "CONFIRMATION_ALREADY_USED",
    });
  });

  it("performs an atomic one-time consume for competing callers", async () => {
    const repository = await repositoryWithEntry();
    const results = await Promise.all([consumeAt(repository), consumeAt(repository)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "CONFIRMATION_ALREADY_USED" },
    ]);
  });

  it("treats the exact ten-minute boundary as expired", async () => {
    const repository = await repositoryWithEntry();

    await expect(
      consumeAt(repository, { now: new Date("2026-09-02T04:10:00.000Z") }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_EXPIRED" });
  });

  it("distinguishes actor mismatch from stale bindings", async () => {
    const actorRepository = await repositoryWithEntry();
    await expect(consumeAt(actorRepository, { actorRef: otherActorRef })).resolves.toEqual({
      ok: false,
      code: "CONFIRMATION_ACTOR_MISMATCH",
    });

    const caseRepository = await repositoryWithEntry();
    await expect(consumeAt(caseRepository, { caseId: otherCaseId })).resolves.toEqual({
      ok: false,
      code: "CONFIRMATION_STALE",
    });

    const revisionRepository = await repositoryWithEntry();
    await expect(consumeAt(revisionRepository, { currentCaseRevision: 5 })).resolves.toEqual({
      ok: false,
      code: "CONFIRMATION_STALE",
    });

    const typeRepository = await repositoryWithEntry();
    await expect(
      consumeAt(typeRepository, { serverExpectedCandidate: fraudCandidate }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_STALE" });

    const hashRepository = await repositoryWithEntry();
    await expect(
      consumeAt(hashRepository, { serverExpectedCandidate: changedProfileCandidate }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_STALE" });
  });

  it("returns not found for an invalid or unknown opaque ID", async () => {
    const repository = await repositoryWithEntry();

    await expect(
      consumePendingConfirmation(repository, {
        confirmationId: "invalid",
        actorRef,
        caseId,
        currentCaseRevision: 4,
        serverExpectedCandidate: profileCandidate,
        now: createdAt,
      }),
    ).resolves.toEqual({ ok: false, code: "CONFIRMATION_NOT_FOUND" });
  });

  it("rejects duplicate IDs and stale revoked records", async () => {
    const repository = await repositoryWithEntry();
    expect(await repository.insert(makeEntry())).toBe("conflict");
    expect(await repository.revokeByIdHash(makeEntry().record.confirmationIdHash)).toBe(true);
    expect(await repository.revokeByIdHash(makeEntry().record.confirmationIdHash)).toBe(false);

    await expect(consumeAt(repository)).resolves.toEqual({
      ok: false,
      code: "CONFIRMATION_STALE",
    });
  });

  it("rejects records whose candidate type or hash was altered", async () => {
    const repository = new InMemoryPendingConfirmationRepository();
    const entry = makeEntry();

    await expect(
      repository.insert({
        ...entry,
        record: { ...entry.record, candidateType: "update_fraud_timeline" },
      }),
    ).rejects.toBeInstanceOf(PendingConfirmationIntegrityError);

    await expect(
      repository.insert({
        ...entry,
        record: { ...entry.record, canonicalPayloadHash: "0".repeat(64) },
      }),
    ).rejects.toBeInstanceOf(PendingConfirmationIntegrityError);
  });
});
