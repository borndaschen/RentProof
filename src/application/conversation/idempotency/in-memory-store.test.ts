import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CompleteIdempotentOperationSchema,
  IdempotencyBindingSchema,
  InMemoryConversationIdempotencyStore,
} from "./in-memory-store";

const actorRef = "actor_abcdefghijklmnopqrst";
const otherActorRef = "actor_zyxwvutsrqponmlkjihg";
const caseId = "case_abcdefghijklmnopqrstu";
const otherCaseId = "case_zyxwvutsrqponmlkjihgf";
const idempotencyKey = "idem_abcdefghijklmnopqrstu";
const otherIdempotencyKey = "idem_zyxwvutsrqponmlkjihgf";
const resultRef = "result_abcdefghijklmnopqrs";
const payloadHash = sha256("normalized turn");
const otherPayloadHash = sha256("different normalized turn");

function binding(
  overrides: Partial<{
    idempotencyKey: string;
    actorRef: string;
    caseId: string;
    normalizedPayloadHash: string;
  }> = {},
) {
  return {
    idempotencyKey,
    actorRef,
    caseId,
    normalizedPayloadHash: payloadHash,
    ...overrides,
  };
}

function requireAcquired(result: ReturnType<InMemoryConversationIdempotencyStore["begin"]>) {
  if (result.kind !== "acquired") {
    throw new Error(`Expected acquired, received ${result.kind}`);
  }
  return result;
}

function completion(acquired: { leaseId: string }, overrides: Record<string, unknown> = {}) {
  return {
    leaseId: acquired.leaseId,
    actorRef,
    caseId,
    idempotencyKey,
    resultRef,
    ...overrides,
  };
}

describe("InMemoryConversationIdempotencyStore", () => {
  it("reuses a pending operation for the same key and normalized payload", () => {
    const store = new InMemoryConversationIdempotencyStore();
    const acquired = requireAcquired(store.begin(binding(), 0));

    expect(store.begin(binding(), 1)).toEqual({
      kind: "pending_reuse",
      operationId: acquired.operationId,
    });
  });

  it("reuses a completed result and releases the case lease", () => {
    const store = new InMemoryConversationIdempotencyStore();
    const acquired = requireAcquired(store.begin(binding(), 0));
    expect(store.complete(completion(acquired), 1)).toEqual({ ok: true });

    expect(store.begin(binding(), 2)).toEqual({
      kind: "result_reuse",
      operationId: acquired.operationId,
      resultRef,
    });
    expect(
      store.begin(
        binding({ idempotencyKey: otherIdempotencyKey, normalizedPayloadHash: otherPayloadHash }),
        2,
      ).kind,
    ).toBe("acquired");
  });

  it.each([
    ["payload", { normalizedPayloadHash: otherPayloadHash }],
    ["actor", { actorRef: otherActorRef }],
    ["case", { caseId: otherCaseId }],
  ] as const)("rejects same-key %s rebinding", (_label, overrides) => {
    const store = new InMemoryConversationIdempotencyStore();
    store.begin(binding(), 0);

    expect(store.begin(binding(overrides), 1)).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("enforces one active operation per case", () => {
    const store = new InMemoryConversationIdempotencyStore();
    store.begin(binding(), 0);

    expect(store.begin(binding({ idempotencyKey: otherIdempotencyKey }), 1)).toEqual({
      kind: "case_busy",
      code: "CONVERSATION_TURN_IN_PROGRESS",
    });
  });

  it("atomically releases a failed operation so its key can retry", () => {
    const store = new InMemoryConversationIdempotencyStore();
    const first = requireAcquired(store.begin(binding(), 0));
    const releaseCommand = {
      leaseId: first.leaseId,
      actorRef,
      caseId,
      idempotencyKey,
    };

    expect(store.release({ ...releaseCommand, actorRef: otherActorRef }, 1)).toBe(false);
    expect(store.release(releaseCommand, 1)).toBe(true);
    expect(store.release(releaseCommand, 2)).toBe(false);
    const second = requireAcquired(store.begin(binding(), 2));
    expect(second.operationId).not.toBe(first.operationId);
  });

  it("does not allow a stale lease to complete or release another operation", () => {
    const store = new InMemoryConversationIdempotencyStore({ pendingLeaseTtlMs: 10 });
    const first = requireAcquired(store.begin(binding(), 0));
    const second = requireAcquired(store.begin(binding(), 10));

    expect(store.complete(completion(first), 11)).toEqual({ ok: false, reason: "stale" });
    expect(
      store.release(
        {
          leaseId: first.leaseId,
          actorRef,
          caseId,
          idempotencyKey,
        },
        11,
      ),
    ).toBe(false);
    expect(store.complete(completion(second), 11)).toEqual({ ok: true });
  });

  it("expires pending leases and completed results at fixed boundaries", () => {
    const store = new InMemoryConversationIdempotencyStore({
      pendingLeaseTtlMs: 10,
      completedRetentionMs: 20,
    });
    const first = requireAcquired(store.begin(binding(), 0));
    const second = requireAcquired(store.begin(binding(), 10));
    expect(second.operationId).not.toBe(first.operationId);
    expect(store.complete(completion(second), 11)).toEqual({ ok: true });
    expect(store.begin(binding(), 30)).toMatchObject({ kind: "result_reuse" });
    expect(store.begin(binding(), 31)).toMatchObject({ kind: "acquired" });
  });

  it("fails closed when bounded retention is full and recovers after expiry", () => {
    const store = new InMemoryConversationIdempotencyStore({
      maxRecords: 1,
      completedRetentionMs: 10,
    });
    const acquired = requireAcquired(store.begin(binding(), 0));
    expect(store.complete(completion(acquired), 1)).toEqual({ ok: true });

    expect(
      store.begin(
        binding({
          idempotencyKey: otherIdempotencyKey,
          caseId: otherCaseId,
          normalizedPayloadHash: otherPayloadHash,
        }),
        2,
      ),
    ).toEqual({ kind: "unavailable" });
    expect(
      store.begin(
        binding({
          idempotencyKey: otherIdempotencyKey,
          caseId: otherCaseId,
          normalizedPayloadHash: otherPayloadHash,
        }),
        11,
      ).kind,
    ).toBe("acquired");
  });

  it("rejects invalid completion commands and timestamps", () => {
    const store = new InMemoryConversationIdempotencyStore();
    expect(() => store.begin(binding(), Number.NaN)).toThrow(RangeError);
    expect(store.complete({ invalid: true }, 0)).toEqual({ ok: false, reason: "invalid" });
    expect(store.release({ invalid: true }, 0)).toBe(false);
  });
});

describe("idempotency schemas and options", () => {
  it("uses strict actor/case/payload-bound schemas", () => {
    expect(
      IdempotencyBindingSchema.safeParse({ ...binding(), result: "client-state" }).success,
    ).toBe(false);
    expect(
      CompleteIdempotentOperationSchema.safeParse({
        leaseId: "lease_abcdefghijklmnopqrstu",
        actorRef,
        caseId,
        idempotencyKey,
        resultRef,
        normalizedPayloadHash: payloadHash,
      }).success,
    ).toBe(false);
  });

  it("rejects unbounded or nonsensical retention settings", () => {
    expect(() => new InMemoryConversationIdempotencyStore({ pendingLeaseTtlMs: 0 })).toThrow(
      RangeError,
    );
    expect(
      () => new InMemoryConversationIdempotencyStore({ completedRetentionMs: Infinity }),
    ).toThrow(RangeError);
    expect(() => new InMemoryConversationIdempotencyStore({ maxRecords: 0 })).toThrow(RangeError);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
