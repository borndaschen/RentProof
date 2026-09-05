import { describe, expect, it, vi } from "vitest";
import type { JobExecutionGate, JobQueueStateStore } from "./contracts";
import { GovernedJobWorker, JobHandlerError, type JobHandler } from "./job-worker";
import { PersistentBoundedJobQueue } from "./persistent-job-queue";

const actorRef = "actor_000000000000000001";
const caseId = "case_0000000000000000001";
const workerId = "worker_00000000000000001";

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
}

function setup() {
  let sequence = 0;
  const queue = new PersistentBoundedJobQueue({
    store: new TestStateStore(),
    idGenerator: () => `opaque_${String(++sequence).padStart(20, "0")}`,
  });
  const handler = vi.fn(async () => ({ resultRef: "result_000000000000000001" }));
  const gate: JobExecutionGate = { authorize: vi.fn(async () => ({ ok: true as const })) };
  const worker = new GovernedJobWorker(queue, gate, {
    "contract.ocr": handler,
    "evidence.video_frames": handler,
    "analysis.pipeline": handler,
  });
  return { queue, gate, handler, worker };
}

async function enqueue(queue: PersistentBoundedJobQueue) {
  return queue.enqueue({
    actorRef,
    idempotencyKey: "idempotency_00000000001",
    priority: "normal",
    work: {
      type: "evidence.video_frames",
      caseId,
      artifactId: "artifact_000000000000001",
      expectedRevision: 2,
    },
  });
}

describe("GovernedJobWorker", () => {
  it("supports a short-lived queue without renewal while still checking the authority", async () => {
    const test = setup();
    await enqueue(test.queue);
    const queue = {
      claim: test.queue.claim.bind(test.queue),
      complete: test.queue.complete.bind(test.queue),
      fail: test.queue.fail.bind(test.queue),
    };
    const handler: JobHandler = async (_work, context) => {
      await context.assertActive();
      return { resultRef: "result_000000000000000001" };
    };
    const worker = new GovernedJobWorker(queue, test.gate, {
      "contract.ocr": handler,
      "evidence.video_frames": handler,
      "analysis.pipeline": handler,
    });
    expect(await worker.runOnce(workerId)).toMatchObject({ status: "succeeded" });
  });

  it("a failed heartbeat permanently fences the result even when the handler returns normally", async () => {
    vi.useFakeTimers();
    try {
      const test = setup();
      const enqueued = await enqueue(test.queue);
      if (!enqueued.ok) throw new Error("ENQUEUE_FAILED");
      const handler: JobHandler = async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 45_000));
        return { resultRef: "result_000000000000000001" };
      };
      const worker = new GovernedJobWorker(test.queue, test.gate, {
        "contract.ocr": handler,
        "evidence.video_frames": handler,
        "analysis.pipeline": handler,
      });
      const running = worker.runOnce(workerId);
      const rejected = expect(running).rejects.toThrow("JOB_LEASE_TRANSITION_FAILED");
      await vi.advanceTimersByTimeAsync(1);
      await test.queue.cancel({ actorRef, caseId, jobId: enqueued.jobId, expectedRevision: 2 });
      await vi.advanceTimersByTimeAsync(45_000);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("returns idle and fails closed when the authority service throws", async () => {
    const test = setup();
    expect(await test.worker.runOnce(workerId)).toEqual({ status: "idle" });
    await enqueue(test.queue);
    vi.mocked(test.gate.authorize).mockRejectedValueOnce(new Error("private authority detail"));
    expect(await test.worker.runOnce(workerId)).toMatchObject({ status: "denied" });
    expect(test.handler).not.toHaveBeenCalled();
    expect(() => new JobHandlerError("private error text", false)).toThrow("JOB_REASON_INVALID");
  });

  it("renews a long-running job and revalidates authority before the final write", async () => {
    vi.useFakeTimers();
    try {
      const test = setup();
      await enqueue(test.queue);
      const handler: JobHandler = async (_work, context) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 75_000));
        await context.assertActive();
        return { resultRef: "result_000000000000000001" };
      };
      const worker = new GovernedJobWorker(test.queue, test.gate, {
        "contract.ocr": handler,
        "evidence.video_frames": handler,
        "analysis.pipeline": handler,
      });
      const running = worker.runOnce(workerId);
      await vi.advanceTimersByTimeAsync(75_000);
      expect(await running).toMatchObject({ status: "succeeded" });
      expect(test.gate.authorize).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not publish when the live authority is revoked during a handler", async () => {
    const test = setup();
    await enqueue(test.queue);
    vi.mocked(test.gate.authorize)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reasonCode: "JOB_POLICY_GATE_FAILED" });
    const write = vi.fn();
    const handler: JobHandler = async (_work, context) => {
      await context.assertActive();
      write();
      return { resultRef: "result_000000000000000001" };
    };
    const worker = new GovernedJobWorker(test.queue, test.gate, {
      "contract.ocr": handler,
      "evidence.video_frames": handler,
      "analysis.pipeline": handler,
    });
    expect(await worker.runOnce(workerId)).toMatchObject({ status: "failed" });
    expect(write).not.toHaveBeenCalled();
  });

  it("fences cancellation during a handler and never reports success", async () => {
    const test = setup();
    const enqueued = await enqueue(test.queue);
    if (!enqueued.ok) throw new Error("ENQUEUE_FAILED");
    const handler: JobHandler = async (_work, context) => {
      await test.queue.cancel({ actorRef, caseId, jobId: enqueued.jobId, expectedRevision: 2 });
      await context.assertActive();
      return { resultRef: "result_000000000000000001" };
    };
    const worker = new GovernedJobWorker(test.queue, test.gate, {
      "contract.ocr": handler,
      "evidence.video_frames": handler,
      "analysis.pipeline": handler,
    });
    await expect(worker.runOnce(workerId)).rejects.toThrow("JOB_LEASE_TRANSITION_FAILED");
    expect(await test.queue.get({ actorRef, caseId, jobId: enqueued.jobId })).toMatchObject({
      state: "cancelled",
    });
  });
  it("revalidates the gate before dispatching an allowlisted handler", async () => {
    const { queue, gate, handler, worker } = setup();
    await enqueue(queue);
    await expect(worker.runOnce(workerId)).resolves.toMatchObject({ status: "succeeded" });
    expect(gate.authorize).toHaveBeenCalledBefore(handler);
    const record = await queue.get({ actorRef, caseId, jobId: "opaque_00000000000000000001" });
    expect(record).toMatchObject({ state: "succeeded", resultRef: "result_000000000000000001" });
  });

  it("does not run a handler when owner or policy authorization is revoked", async () => {
    const { queue, gate, handler, worker } = setup();
    vi.mocked(gate.authorize).mockResolvedValueOnce({
      ok: false,
      reasonCode: "JOB_POLICY_GATE_FAILED",
    });
    await enqueue(queue);
    await expect(worker.runOnce(workerId)).resolves.toMatchObject({ status: "denied" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("records bounded retry state without exposing unexpected handler errors", async () => {
    const { queue, handler, worker } = setup();
    handler.mockRejectedValueOnce(new Error("secret provider body"));
    await enqueue(queue);
    await expect(worker.runOnce(workerId)).resolves.toMatchObject({ status: "failed" });
    const record = await queue.get({ actorRef, caseId, jobId: "opaque_00000000000000000001" });
    expect(record).toMatchObject({ state: "queued", reasonCode: "JOB_HANDLER_FAILED" });
  });
});
