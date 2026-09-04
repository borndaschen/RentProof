import { describe, expect, it } from "vitest";
import { InMemoryBoundedJobQueue } from "./bounded-job-queue";

const actorRef = "actor_queue_test_00000001";
const caseId = "case_queue_test_000000001";
const artifactId = "artifact_queue_test_00001";

function harness(overrides: Record<string, number> = {}) {
  let now = 1_000;
  let sequence = 0;
  const queue = new InMemoryBoundedJobQueue({
    clock: () => now,
    idGenerator: () => `queue_id_${String((sequence += 1)).padStart(20, "0")}`,
    ...overrides,
  });
  return { queue, setNow: (value: number) => (now = value) };
}

function command(
  idempotencyKey = "idempotency_queue_000001",
  type: "contract.ocr" | "evidence.video_frames" | "analysis.pipeline" = "contract.ocr",
  targetCaseId = caseId,
) {
  return {
    actorRef,
    idempotencyKey,
    priority: "normal" as const,
    work:
      type === "analysis.pipeline"
        ? { type, caseId: targetCaseId, expectedRevision: 1 }
        : { type, caseId: targetCaseId, artifactId, expectedRevision: 1 },
  };
}

describe("InMemoryBoundedJobQueue", () => {
  it("reuses an identical idempotency binding and rejects a changed payload", () => {
    const { queue } = harness();
    const first = queue.enqueue(command());
    expect(first).toMatchObject({ ok: true, reused: false });
    expect(queue.enqueue(command())).toEqual({ ...first, reused: true });
    expect(queue.enqueue({ ...command(), priority: "blocking" })).toEqual({
      ok: false,
      code: "JOB_IDEMPOTENCY_CONFLICT",
    });
  });

  it("claims by priority and completes only with the bound worker lease", () => {
    const { queue } = harness();
    queue.enqueue(command("idempotency_queue_000002", "contract.ocr", "case_queue_a_00000000001"));
    queue.enqueue({
      ...command("idempotency_queue_000003", "evidence.video_frames", "case_queue_b_00000000001"),
      priority: "blocking",
    });
    const claimed = queue.claim("worker_queue_00000000001", [
      "contract.ocr",
      "evidence.video_frames",
    ]);
    expect(claimed?.work.type).toBe("evidence.video_frames");
    expect(
      queue.complete({
        jobId: claimed?.jobId,
        leaseId: "wrong_lease_000000000001",
        workerId: "worker_queue_00000000001",
        resultRef: "result_queue_00000000001",
      }),
    ).toEqual({ ok: false, code: "JOB_LEASE_STALE" });
    expect(
      queue.complete({
        jobId: claimed?.jobId,
        leaseId: claimed?.leaseId,
        workerId: "worker_queue_00000000001",
        resultRef: "result_queue_00000000001",
      }),
    ).toEqual({ ok: true, state: "succeeded" });
  });

  it("enforces global and per-case concurrency", () => {
    const { queue } = harness({ maxRunning: 2 });
    queue.enqueue(command("idempotency_queue_000004", "contract.ocr"));
    queue.enqueue(command("idempotency_queue_000005", "evidence.video_frames"));
    queue.enqueue(
      command("idempotency_queue_000006", "analysis.pipeline", "case_queue_c_00000000001"),
    );
    expect(queue.claim("worker_queue_00000000002", ["contract.ocr"])?.work.type).toBe(
      "contract.ocr",
    );
    expect(queue.claim("worker_queue_00000000003", ["evidence.video_frames"])).toBeNull();
    expect(queue.claim("worker_queue_00000000003", ["analysis.pipeline"])?.work.caseId).toBe(
      "case_queue_c_00000000001",
    );
    expect(queue.claim("worker_queue_00000000004", ["analysis.pipeline"])).toBeNull();
  });

  it("retries bounded failures then records a terminal failure", () => {
    const { queue, setNow } = harness({ maxAttempts: 2, retryDelayMs: 100 });
    const enqueued = queue.enqueue(command("idempotency_queue_000007"));
    if (!enqueued.ok) throw new Error("TEST_ENQUEUE_FAILED");
    const first = queue.claim("worker_queue_00000000005", ["contract.ocr"]);
    expect(
      queue.fail({
        jobId: first?.jobId,
        leaseId: first?.leaseId,
        workerId: "worker_queue_00000000005",
        reasonCode: "OCR_TEMPORARY_FAILURE",
        retryable: true,
      }),
    ).toEqual({ ok: true, state: "queued" });
    expect(queue.claim("worker_queue_00000000005", ["contract.ocr"])).toBeNull();
    setNow(1_100);
    const second = queue.claim("worker_queue_00000000005", ["contract.ocr"]);
    expect(second?.attempt).toBe(2);
    expect(
      queue.fail({
        jobId: second?.jobId,
        leaseId: second?.leaseId,
        workerId: "worker_queue_00000000005",
        reasonCode: "OCR_TEMPORARY_FAILURE",
        retryable: true,
      }),
    ).toEqual({ ok: true, state: "failed" });
    expect(queue.get(enqueued.jobId)?.reasonCode).toBe("OCR_TEMPORARY_FAILURE");
  });

  it("requeues expired leases and purges terminal records after retention", () => {
    const { queue, setNow } = harness({ leaseMs: 50, terminalRetentionMs: 100 });
    const enqueued = queue.enqueue(command("idempotency_queue_000008"));
    if (!enqueued.ok) throw new Error("TEST_ENQUEUE_FAILED");
    expect(queue.claim("worker_queue_00000000006", ["contract.ocr"])?.attempt).toBe(1);
    setNow(1_050);
    const reclaimed = queue.claim("worker_queue_00000000007", ["contract.ocr"]);
    expect(reclaimed?.attempt).toBe(2);
    queue.complete({
      jobId: reclaimed?.jobId,
      leaseId: reclaimed?.leaseId,
      workerId: "worker_queue_00000000007",
      resultRef: "result_queue_00000000002",
    });
    setNow(1_150);
    queue.enqueue(command("idempotency_queue_000009", "analysis.pipeline"));
    expect(queue.get(enqueued.jobId)).toBeNull();
  });

  it("fails closed at capacity and for invalid commands, ids, clocks, or options", () => {
    const { queue } = harness({ maxRecords: 1 });
    expect(queue.enqueue(command("idempotency_queue_000010")).ok).toBe(true);
    expect(queue.enqueue(command("idempotency_queue_000011", "analysis.pipeline"))).toEqual({
      ok: false,
      code: "JOB_QUEUE_CAPACITY_EXCEEDED",
    });
    expect(() => queue.enqueue({})).toThrow();
    expect(() => queue.claim("short", ["contract.ocr"])).toThrow("JOB_QUEUE_ID_INVALID");
    expect(() => new InMemoryBoundedJobQueue({ maxRecords: 0, idGenerator: () => "x" })).toThrow(
      RangeError,
    );
    const invalidClock = new InMemoryBoundedJobQueue({
      clock: () => Number.NaN,
      idGenerator: () => "queue_id_00000000000000000001",
    });
    expect(() => invalidClock.enqueue(command("idempotency_queue_000012"))).toThrow(
      "JOB_QUEUE_CLOCK_INVALID",
    );
  });

  it("never accepts document bytes, OCR text, URLs, or commands in a job payload", () => {
    const { queue } = harness();
    for (const extra of [
      { bytes: new Uint8Array([1]) },
      { ocrText: "private contract text" },
      { url: "https://example.invalid" },
      { command: "run arbitrary task" },
    ]) {
      expect(() =>
        queue.enqueue({
          ...command("idempotency_queue_000013"),
          work: { ...command().work, ...extra },
        }),
      ).toThrow();
    }
  });
});
