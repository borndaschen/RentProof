import { describe, expect, it, vi } from "vitest";
import type { JobExecutionGate, JobQueueStateStore } from "./contracts";
import { GovernedJobWorker } from "./job-worker";
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
