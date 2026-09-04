import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ConsumePiiAcknowledgementSchema,
  InMemoryPiiAcknowledgementStore,
  PiiAcknowledgementStoreCapacityError,
  PiiAcknowledgementRecordSchema,
} from "./pii-acknowledgement";

const actorRef = "actor_abcdefghijklmnopqrst";
const caseId = "case_abcdefghijklmnopqrstu";
const payloadHash = createHash("sha256").update("normalized turn").digest("hex");
const otherPayloadHash = createHash("sha256").update("other turn").digest("hex");

function issue(store: InMemoryPiiAcknowledgementStore, nowMs = 0) {
  return store.issue({
    actorRef,
    caseId,
    caseRevision: 4,
    payloadHash,
    detectorVersion: "conversation-sensitive-content.v1",
    nowMs,
  });
}

function command(acknowledgementId: string) {
  return {
    acknowledgementId,
    actorRef,
    caseId,
    expectedCaseRevision: 4,
    payloadHash,
  };
}

describe("InMemoryPiiAcknowledgementStore", () => {
  it("issues a bounded opaque acknowledgement and consumes it once", () => {
    const store = new InMemoryPiiAcknowledgementStore();
    const acknowledgement = issue(store);

    expect(acknowledgement.acknowledgementId).toMatch(/^[A-Za-z0-9_-]{20,128}$/u);
    expect(acknowledgement.expiresAt).toBe("1970-01-01T00:10:00.000Z");
    expect(store.consume(command(acknowledgement.acknowledgementId), 1)).toEqual({ ok: true });
    expect(store.consume(command(acknowledgement.acknowledgementId), 2)).toEqual({
      ok: false,
      code: "PII_ACK_ALREADY_USED",
    });
  });

  it("expires at ten minutes without sliding", () => {
    const store = new InMemoryPiiAcknowledgementStore();
    const acknowledgement = issue(store, 100);

    expect(store.consume(command(acknowledgement.acknowledgementId), 600_099)).toEqual({
      ok: true,
    });

    const second = issue(store, 100);
    expect(store.consume(command(second.acknowledgementId), 600_100)).toEqual({
      ok: false,
      code: "PII_ACK_EXPIRED",
    });
  });

  it.each([
    ["actor", { actorRef: "actor_different_abcdefghij" }],
    ["case", { caseId: "case_different_abcdefghijk" }],
    ["revision", { expectedCaseRevision: 5 }],
    ["payload", { payloadHash: otherPayloadHash }],
  ] as const)("rejects a stale %s binding without consuming the valid ack", (_label, change) => {
    const store = new InMemoryPiiAcknowledgementStore();
    const acknowledgement = issue(store);
    const validCommand = command(acknowledgement.acknowledgementId);

    expect(store.consume({ ...validCommand, ...change }, 1)).toEqual({
      ok: false,
      code: "PII_ACK_STALE",
    });
    expect(store.consume(validCommand, 2)).toEqual({ ok: true });
  });

  it("rejects unknown, revoked, and schema-invalid acknowledgements", () => {
    const store = new InMemoryPiiAcknowledgementStore();
    expect(store.consume(command("unknown_acknowledgement_abcdefghijklmnop"), 1)).toEqual({
      ok: false,
      code: "PII_ACK_STALE",
    });

    const acknowledgement = issue(store);
    store.revoke(acknowledgement.acknowledgementId);
    expect(store.consume(command(acknowledgement.acknowledgementId), 1)).toEqual({
      ok: false,
      code: "PII_ACK_STALE",
    });
    expect(
      store.consume({ ...command(acknowledgement.acknowledgementId), unexpected: true }, 1),
    ).toEqual({ ok: false, code: "PII_ACK_STALE" });
  });

  it("fails closed at capacity without evicting a live acknowledgement", () => {
    const store = new InMemoryPiiAcknowledgementStore({ maxRecords: 1 });
    const acknowledgement = issue(store);

    expect(() => issue(store, 1)).toThrow(PiiAcknowledgementStoreCapacityError);
    expect(store.consume(command(acknowledgement.acknowledgementId), 2)).toEqual({ ok: true });
  });

  it("prunes terminal records after one additional TTL and recovers capacity", () => {
    const store = new InMemoryPiiAcknowledgementStore({ maxRecords: 1 });
    const acknowledgement = issue(store, 100);

    expect(store.consume(command(acknowledgement.acknowledgementId), 600_100)).toEqual({
      ok: false,
      code: "PII_ACK_EXPIRED",
    });
    expect(() => issue(store, 1_200_099)).toThrow(PiiAcknowledgementStoreCapacityError);
    const replacement = issue(store, 1_200_100);
    expect(replacement.acknowledgementId).not.toBe(acknowledgement.acknowledgementId);
    expect(store.consume(command(acknowledgement.acknowledgementId), 1_200_101)).toEqual({
      ok: false,
      code: "PII_ACK_STALE",
    });
  });

  it("validates capacity, retention, and caller-supplied time", () => {
    expect(() => new InMemoryPiiAcknowledgementStore({ maxRecords: 0 })).toThrow(RangeError);
    expect(() => new InMemoryPiiAcknowledgementStore({ maxRecords: 1.5 })).toThrow(RangeError);
    expect(() => new InMemoryPiiAcknowledgementStore({ terminalRetentionMs: -1 })).toThrow(
      RangeError,
    );
    expect(() => issue(new InMemoryPiiAcknowledgementStore(), Number.NaN)).toThrow(RangeError);
  });
});

describe("PII acknowledgement schemas", () => {
  it("are strict and never store the raw acknowledgement ID", () => {
    expect(
      ConsumePiiAcknowledgementSchema.safeParse({
        ...command("acknowledgement_abcdefghijklmnopqrst"),
        confirmed: true,
      }).success,
    ).toBe(false);
    expect(
      PiiAcknowledgementRecordSchema.safeParse({
        acknowledgementId: "raw-id-must-not-be-stored",
        actorRef,
        caseId,
        caseRevision: 4,
        payloadHash,
        detectorVersion: "v1",
        createdAt: "2026-09-02T00:00:00.000Z",
        expiresAt: "2026-09-02T00:10:00.000Z",
        status: "pending",
        consumedAt: null,
      }).success,
    ).toBe(false);
  });
});
