import { describe, expect, it } from "vitest";
import type { JobQueueStateStore } from "./contracts";
import { PersistentBoundedJobQueue } from "./persistent-job-queue";

class TestStateStore implements JobQueueStateStore {
  private text: string | null = null;
  async readText(): Promise<string | null> {
    return this.text;
  }
  async writeTextIfUnchanged(expectedText: string | null, nextText: string): Promise<boolean> {
    if (this.text !== expectedText) return false;
    this.text = nextText;
    return true;
  }
  seedRaw(value: string | null): void {
    this.text = value;
  }
}

const actorRef = "actor_persistent_queue_001";
const otherActorRef = "actor_persistent_queue_002";
const caseId = "case_persistent_queue_0001";
const otherCaseId = "case_persistent_queue_0002";
const artifactId = "artifact_persistent_queue_01";
const workerId = "worker_persistent_queue_001";
const resultRef = "result_persistent_queue_001";

function command(
  idempotencyKey = "idempotency_persistent_001",
  targetCaseId = caseId,
  targetActor = actorRef,
) {
  return {
    actorRef: targetActor,
    idempotencyKey,
    priority: "normal" as const,
    work: {
      type: "contract.ocr" as const,
      caseId: targetCaseId,
      artifactId,
      expectedRevision: 4,
    },
  };
}

function harness(store = new TestStateStore(), overrides: Record<string, number> = {}) {
  let now = 1_000;
  let sequence = 0;
  const makeQueue = () =>
    new PersistentBoundedJobQueue({
      store,
      clock: () => now,
      idGenerator: () => `persistent_id_${String((sequence += 1)).padStart(20, "0")}`,
      ...overrides,
    });
  return { store, makeQueue, setNow: (value: number) => (now = value) };
}

describe("PersistentBoundedJobQueue", () => {
  it("persists enqueue, idempotency and completion across queue instances", async () => {
    const { makeQueue } = harness();
    const firstQueue = makeQueue();
    const first = await firstQueue.enqueue(command());
    expect(first).toMatchObject({ ok: true, reused: false });

    const restarted = makeQueue();
    expect(await restarted.enqueue(command())).toEqual({ ...first, reused: true });
    await expect(
      restarted.enqueue(command("idempotency_persistent_001", otherCaseId, otherActorRef)),
    ).resolves.toMatchObject({ ok: true, reused: false });
    expect(await restarted.enqueue({ ...command(), priority: "blocking" })).toEqual({
      ok: false,
      code: "JOB_IDEMPOTENCY_CONFLICT",
    });
    const claimed = await restarted.claim(workerId, ["contract.ocr"]);
    expect(claimed).toMatchObject({ work: { caseId }, attempt: 1 });
    await expect(
      restarted.complete({
        jobId: claimed?.jobId,
        leaseId: claimed?.leaseId,
        workerId,
        resultRef,
      }),
    ).resolves.toEqual({ ok: true, state: "succeeded" });
    expect(
      (
        await makeQueue().get({
          actorRef,
          jobId: claimed?.jobId,
          caseId,
        })
      )?.resultRef,
    ).toBe(resultRef);
  });

  it("reclaims an expired lease after restart and rejects the stale lease", async () => {
    const { makeQueue, setNow } = harness(undefined, { leaseMs: 50, maxAttempts: 2 });
    const queue = makeQueue();
    await queue.enqueue(command("idempotency_persistent_002"));
    const abandoned = await queue.claim(workerId, ["contract.ocr"]);
    setNow(1_050);
    const restarted = makeQueue();
    const reclaimed = await restarted.claim("worker_persistent_queue_002", ["contract.ocr"]);
    expect(reclaimed?.attempt).toBe(2);
    await expect(
      restarted.complete({
        jobId: abandoned?.jobId,
        leaseId: abandoned?.leaseId,
        workerId,
        resultRef,
      }),
    ).resolves.toEqual({ ok: false, code: "JOB_LEASE_STALE" });
  });

  it("atomically cancels running work and supports owner-bound delete and case purge", async () => {
    const { makeQueue } = harness();
    const queue = makeQueue();
    const first = await queue.enqueue(command("idempotency_persistent_003"));
    const second = await queue.enqueue(
      command("idempotency_persistent_004", otherCaseId, otherActorRef),
    );
    if (!first.ok || !second.ok) throw new Error("TEST_ENQUEUE_FAILED");
    const claimed = await queue.claim(workerId, ["contract.ocr"]);
    await expect(
      queue.cancel({ actorRef: otherActorRef, jobId: first.jobId, caseId, expectedRevision: 4 }),
    ).resolves.toEqual({ ok: false, code: "JOB_NOT_FOUND_OR_FORBIDDEN" });
    await expect(
      queue.cancel({ actorRef, jobId: first.jobId, caseId, expectedRevision: 3 }),
    ).resolves.toEqual({ ok: false, code: "JOB_REVISION_STALE" });
    await expect(
      queue.cancel({ actorRef, jobId: first.jobId, caseId, expectedRevision: 4 }),
    ).resolves.toEqual({ ok: true, state: "cancelled" });
    await expect(
      queue.complete({
        jobId: claimed?.jobId,
        leaseId: claimed?.leaseId,
        workerId,
        resultRef,
      }),
    ).resolves.toEqual({ ok: false, code: "JOB_LEASE_STALE" });
    await expect(queue.delete({ actorRef, jobId: first.jobId, caseId })).resolves.toEqual({
      ok: true,
      deleted: true,
    });
    await expect(
      queue.purgeCase({ actorRef: otherActorRef, caseId: otherCaseId }),
    ).resolves.toEqual({ ok: true, deletedCount: 1 });
    expect(
      await queue.get({ actorRef: otherActorRef, jobId: second.jobId, caseId: otherCaseId }),
    ).toBeNull();
  });

  it("does not delete active jobs individually and enforces bounded capacity", async () => {
    const { makeQueue } = harness(undefined, { maxRecords: 1 });
    const queue = makeQueue();
    const first = await queue.enqueue(command("idempotency_persistent_005"));
    if (!first.ok) throw new Error("TEST_ENQUEUE_FAILED");
    await expect(queue.delete({ actorRef, jobId: first.jobId, caseId })).resolves.toEqual({
      ok: false,
      code: "JOB_NOT_TERMINAL",
    });
    await expect(queue.enqueue(command("idempotency_persistent_006"))).resolves.toEqual({
      ok: false,
      code: "JOB_QUEUE_CAPACITY_EXCEEDED",
    });
  });

  it("uses compare-and-swap to prevent concurrent enqueue from exceeding capacity", async () => {
    const { makeQueue } = harness(undefined, { maxRecords: 1 });
    const results = await Promise.all([
      makeQueue().enqueue(command("idempotency_persistent_011")),
      makeQueue().enqueue(command("idempotency_persistent_012")),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "JOB_QUEUE_CAPACITY_EXCEEDED" },
    ]);
  });

  it("purges retained terminal records and permits the idempotency key again", async () => {
    const { makeQueue, setNow } = harness(undefined, { terminalRetentionMs: 100 });
    const queue = makeQueue();
    const first = await queue.enqueue(command("idempotency_persistent_007"));
    if (!first.ok) throw new Error("TEST_ENQUEUE_FAILED");
    const claimed = await queue.claim(workerId, ["contract.ocr"]);
    await queue.complete({
      jobId: claimed?.jobId,
      leaseId: claimed?.leaseId,
      workerId,
      resultRef,
    });
    setNow(1_100);
    const replacement = await makeQueue().enqueue(command("idempotency_persistent_007"));
    expect(replacement).toMatchObject({ ok: true, reused: false });
    if (!replacement.ok) throw new Error("TEST_ENQUEUE_FAILED");
    expect(replacement.jobId).not.toBe(first.jobId);
  });

  it("fails closed on malformed or incompatible persisted state", async () => {
    const { store, makeQueue } = harness(undefined, { maxRecords: 1 });
    for (const raw of [
      "not-json",
      JSON.stringify({ schemaVersion: "wrong", revision: 0, records: [] }),
      JSON.stringify({
        schemaVersion: "rentproof.job-queue.v1",
        revision: 0,
        records: [{ state: "queued" }],
      }),
    ]) {
      store.seedRaw(raw);
      await expect(
        makeQueue().enqueue(command("idempotency_persistent_008")),
      ).rejects.toMatchObject({ code: "JOB_QUEUE_CORRUPT" });
    }

    store.seedRaw(null);
    let sequence = 0;
    const widerQueue = new PersistentBoundedJobQueue({
      store,
      maxRecords: 2,
      clock: () => 1_000,
      idGenerator: () => `persistent_wide_${String((sequence += 1)).padStart(20, "0")}`,
    });
    await widerQueue.enqueue(command("idempotency_persistent_013"));
    await widerQueue.enqueue(command("idempotency_persistent_014", otherCaseId));
    await expect(
      makeQueue().get({
        actorRef,
        jobId: "persistent_wide_00000000000000000001",
        caseId,
      }),
    ).rejects.toMatchObject({ code: "JOB_QUEUE_CORRUPT" });
  });

  it("retries compare-and-swap contention and rejects an invalid clock", async () => {
    const backing = new TestStateStore();
    let conflicts = 1;
    const store = {
      readText: () => backing.readText(),
      writeTextIfUnchanged: async (expectedText: string | null, nextText: string) => {
        if (conflicts > 0) {
          conflicts -= 1;
          return false;
        }
        return backing.writeTextIfUnchanged(expectedText, nextText);
      },
    };
    const queue = new PersistentBoundedJobQueue({
      store,
      clock: () => 1_000,
      idGenerator: () => "persistent_id_00000000000000000001",
    });
    await expect(queue.enqueue(command("idempotency_persistent_009"))).resolves.toMatchObject({
      ok: true,
    });
    const invalidClock = new PersistentBoundedJobQueue({
      store: new TestStateStore(),
      clock: () => Number.NaN,
      idGenerator: () => "persistent_id_00000000000000000002",
    });
    await expect(invalidClock.enqueue(command("idempotency_persistent_010"))).rejects.toMatchObject(
      {
        code: "JOB_QUEUE_CLOCK_INVALID",
      },
    );

    const contended = new PersistentBoundedJobQueue({
      store: { readText: async () => null, writeTextIfUnchanged: async () => false },
      maxContentionRetries: 1,
      clock: () => 1_000,
      idGenerator: () => "persistent_id_00000000000000000003",
    });
    await expect(contended.enqueue(command("idempotency_persistent_015"))).rejects.toMatchObject({
      code: "JOB_QUEUE_CONTENTION",
    });
  });
});
