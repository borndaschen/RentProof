import { createHash } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import {
  REAL_DEMO_CLOUD_CONSENT_TEXT,
  REAL_DEMO_CLOUD_CONSENT_VERSION,
} from "@/application/real-demo";
import { createOcrConfirmation } from "@/application/ocr/confirm-ocr";
import { assessOcrProviderOutput } from "@/domain/ocr";
import type { ProcessingRecord } from "@/application/processing/contracts";
import type { RentProofDatabase } from "./database";
import { PostgresProcessingRepository, PostgresJobQueueStateStore } from "./processing-repository";
import { PostgresEvidenceBudgetRepository } from "./evidence-budget-repository";

const actor = {
  kind: "user",
  userId: "user_000000000000000001",
  sessionId: "session_000000000000001",
} as const;
const caseId = "case_000000000000000001";
const artifactId = "artifact_000000000000001";
const policyHash = createHash("sha256").update(REAL_DEMO_CLOUD_CONSENT_TEXT).digest("hex");
const stored = {
  originalRelativePath: `${caseId}/${artifactId}/original.enc`,
  derivativeRelativePath: null,
  extractedTextRelativePath: `${caseId}/${artifactId}/extracted-text.enc`,
  derivativeSha256: null,
  derivativeBytes: null,
};
const candidate = () =>
  createOcrConfirmation({
    actor,
    caseId,
    artifactId,
    expectedRevision: 0,
    policyHash,
    nowMs: Date.now(),
    confirmationId: "confirmation_00000000001",
    assessment: assessOcrProviderOutput(
      {
        pages: [
          {
            page: 1,
            quality: "clear",
            lines: [{ text: "租金", confidence: 1, bbox: [0, 0, 1, 1] }],
          },
        ],
      },
      1,
    ),
  });
function record(): ProcessingRecord {
  return {
    actor,
    reservation: {
      caseId,
      artifactId,
      kind: "contract_pdf",
      mime: "application/pdf",
      originalSha256: "a".repeat(64),
      originalBytes: 100,
    },
    idempotencyHash: "b".repeat(64),
    expectedRevision: 0,
    policyHash,
    type: "contract.ocr",
    state: "queued",
    stored,
    confirmation: null,
    reasonCode: null,
    jobId: null,
  };
}

function fixture() {
  const queries: { text: string; parameters: readonly unknown[] }[] = [];
  let session = true;
  let owner = true;
  let revision = 0;
  let validPolicy = true;
  let count = "0";
  let totalBytes = "0";
  let current: ProcessingRecord | null = record();
  let events: unknown = [];
  let payload: string | null = null;
  const pool = {
    on() {
      return this;
    },
    async end() {},
    async connect() {
      return {
        release() {},
        async query(text: string, parameters: readonly unknown[] = []): Promise<QueryResult> {
          queries.push({ text, parameters });
          let rows: QueryResultRow[] = [];
          if (
            text.startsWith("select") &&
            (text.includes('from "auth_sessions"') || text.includes('from "guest_sessions"'))
          )
            rows = session ? [{ id: actor.sessionId }] : [];
          else if (text.startsWith("select") && text.includes('from "rental_cases"'))
            rows = owner
              ? [
                  {
                    revision,
                    state: validPolicy
                      ? {
                          cloudProcessingConsentVersion: REAL_DEMO_CLOUD_CONSENT_VERSION,
                          cloudProcessingAcknowledgedAt: new Date().toISOString(),
                          analysisSnapshot: { old: true },
                        }
                      : {},
                  },
                ]
              : [];
          else if (text.startsWith("select") && text.includes('from "artifact_processing"'))
            rows = text.includes("count(")
              ? [{ count, totalBytes }]
              : current
                ? [{ record: current }]
                : [];
          else if (text.startsWith("select") && text.includes('from "case_artifacts"'))
            rows = [{ total: "0" }];
          else if (text.startsWith('update "artifact_processing"')) {
            current = parameters[0] as ProcessingRecord;
          } else if (text.startsWith("select") && text.includes('from "runtime_queue_state"'))
            rows = [{ payload }];
          else if (text.startsWith('update "runtime_queue_state"')) {
            const expected = parameters[2] ?? null;
            if (payload === expected) {
              payload = String(parameters[0]);
              rows = [{ id: "media" }];
            }
          } else if (text.startsWith("select") && text.includes('from "case_evidence_budgets"')) {
            rows = text.includes("@>") ? [{ case_id: caseId }] : [{ events }];
          } else if (text.startsWith('update "case_evidence_budgets"'))
            events = JSON.parse(String(parameters[0])) as unknown;
          return {
            rows,
            rowCount: rows.length,
            command: text.split(" ")[0] ?? "",
            fields: [],
            oid: 0,
          };
        },
      };
    },
  };
  const db = new Kysely<RentProofDatabase>({
    dialect: new PostgresDialect({ pool: pool as unknown as Pool }),
  });
  return {
    db,
    queries,
    repo: new PostgresProcessingRepository(db),
    setSession: (value: boolean) => {
      session = value;
    },
    setOwner: (value: boolean) => {
      owner = value;
    },
    setRevision: (value: number) => {
      revision = value;
    },
    setPolicy: (value: boolean) => {
      validPolicy = value;
    },
    setCount: (value: string) => {
      count = value;
    },
    setTotalBytes: (value: string) => {
      totalBytes = value;
    },
    setRecord: (value: ProcessingRecord | null) => {
      current = value;
    },
    setEvents: (value: unknown) => {
      events = value;
    },
    getRecord: () => current,
  };
}

describe("PostgreSQL processing boundaries", () => {
  it("includes pending video bytes in the case storage cap", async () => {
    const test = fixture();
    test.setTotalBytes(String(400 * 1024 * 1024));
    const base = record();
    await expect(
      test.repo.create({
        ...base,
        type: "evidence.video_frames",
        reservation: { ...base.reservation, kind: "viewing_video", mime: "video/mp4" },
      }),
    ).rejects.toThrow("REAL_DEMO_CASE_IMAGE_LIMIT_EXCEEDED");
    expect(
      test.queries.some((query) => query.text.startsWith('insert into "artifact_processing"')),
    ).toBe(false);
    await test.db.destroy();
  });
  it("locks the active session and owner case before inserting a pending record", async () => {
    const test = fixture();
    await test.repo.create(record());
    const session = test.queries.find((query) => query.text.includes('from "auth_sessions"'));
    expect(session?.text).toContain("for update");
    expect(session?.parameters).toContain(actor.sessionId);
    const owned = test.queries.find((query) => query.text.includes('from "rental_cases"'));
    expect(owned?.text).toContain('"owner_subject_id"');
    expect(owned?.text).toContain('"deleted_at" is null');
    expect(owned?.text).toContain("for update");
    expect(owned?.parameters).toContain(actor.userId);
    expect(test.queries.at(-1)?.text).toBe("commit");
    await test.db.destroy();
  });
  it.each(["session", "owner", "policy", "revision", "capacity"])(
    "does not insert when %s gate fails",
    async (gate) => {
      const test = fixture();
      if (gate === "session") test.setSession(false);
      if (gate === "owner") test.setOwner(false);
      if (gate === "policy") test.setPolicy(false);
      if (gate === "revision") test.setRevision(1);
      if (gate === "capacity") test.setCount("16");
      await expect(test.repo.create(record())).rejects.toThrow();
      expect(
        test.queries.some((query) => query.text.startsWith('insert into "artifact_processing"')),
      ).toBe(false);
      expect(test.queries.at(-1)?.text).toBe("rollback");
      await test.db.destroy();
    },
  );
  it("looks up candidates only within the case and same actor session", async () => {
    const test = fixture();
    expect(await test.repo.find(actor, caseId, artifactId)).toEqual(record());
    expect(await test.repo.findByKey(actor, caseId, "b".repeat(64))).toEqual(record());
    expect(await test.repo.findWork(actor.sessionId, caseId, artifactId)).toEqual(record());
    for (const query of test.queries.filter((query) =>
      query.text.includes('from "artifact_processing"'),
    )) {
      expect(query.parameters).toContain(caseId);
      expect(query.parameters).toContain(actor.sessionId);
    }
    test.setRecord(null);
    expect(await test.repo.find(actor, caseId, artifactId)).toBeNull();
    expect(await test.repo.findWork(actor.sessionId, caseId, artifactId)).toBeNull();
    await test.db.destroy();
  });
  it("atomically consumes OCR confirmation and clears the old analysis snapshot", async () => {
    const test = fixture();
    const prepared = candidate();
    const pending = {
      ...record(),
      state: "requires_confirmation" as const,
      confirmation: prepared.confirmation,
    };
    test.setRecord(pending);
    await test.repo.finalize(pending, stored, {
      confirmationId: prepared.confirmation.confirmationId,
      pages: prepared.pages,
      nowMs: Date.now(),
    });
    expect(test.getRecord()?.confirmation?.state).toBe("used");
    const update = test.queries.find((query) => query.text.startsWith('update "rental_cases"'));
    expect(JSON.stringify(update?.parameters)).not.toContain("analysisSnapshot");
    expect(test.queries.at(-1)?.text).toBe("commit");
    await expect(
      test.repo.finalize(pending, stored, {
        confirmationId: prepared.confirmation.confirmationId,
        pages: prepared.pages,
        nowMs: Date.now(),
      }),
    ).rejects.toThrow("OCR_CONFIRMATION_USED");
    await test.db.destroy();
  });
  it("requires human confirmation before a contract can become available", async () => {
    const test = fixture();
    await expect(test.repo.finalize(record(), stored)).rejects.toThrow(
      "OCR_HUMAN_CONFIRMATION_REQUIRED",
    );
    expect(
      test.queries.some((query) => query.text.startsWith('insert into "case_artifacts"')),
    ).toBe(false);
    await test.db.destroy();
  });
  it("can cancel stale work but cannot overwrite another terminal state", async () => {
    const test = fixture();
    test.setRevision(3);
    await test.repo.replace({ ...record(), state: "cancelled" }, "queued");
    await expect(test.repo.replace({ ...record(), state: "cancelled" }, "queued")).rejects.toThrow(
      "PROCESSING_STATE_STALE",
    );
    await test.db.destroy();
  });
  it("uses the fixed guest session and expiry constraints", async () => {
    const test = fixture();
    await test.repo.authorize(
      {
        kind: "guest",
        guestId: "guest_00000000000000001",
        guestSessionId: "guest_session_000000001",
      },
      caseId,
    );
    const query = test.queries.find((item) => item.text.includes('from "guest_sessions"'));
    expect(query?.text).toContain('"guest_identities"."expires_at"');
    expect(query?.text).toContain('"revoked_at" is null');
    await test.db.destroy();
  });
});

describe("durable queue and evidence budget", () => {
  it("uses compare-and-swap instead of overwriting a concurrent queue snapshot", async () => {
    const test = fixture();
    const store = new PostgresJobQueueStateStore(test.db);
    expect(await store.readText()).toBeNull();
    expect(await store.writeTextIfUnchanged(null, "first")).toBe(true);
    expect(await store.writeTextIfUnchanged(null, "lost update")).toBe(false);
    expect(await store.writeTextIfUnchanged("first", "second")).toBe(true);
    expect(await store.readText()).toBe("second");
    await test.db.destroy();
  });
  it("preserves reservations and unknown usage across repository instances", async () => {
    const test = fixture();
    const first = new PostgresEvidenceBudgetRepository(test.db);
    const input = {
      operationKind: "provider_request" as const,
      caseId,
      reservationId: "reservation_00000000001",
      model: "gpt-5.6-terra",
      maximumProviderAttempts: 1,
      maximumInputTokens: 200_000,
      maximumOutputAndReasoningTokens: 24_000,
    };
    expect(await first.reserve(input)).toMatchObject({ ok: true, metered: true });
    const restarted = new PostgresEvidenceBudgetRepository(test.db);
    expect(await restarted.get(caseId)).toMatchObject({ activeReservationCount: 1 });
    expect(
      await restarted.reconcile({
        reservationId: input.reservationId,
        usage: { kind: "unknown", actualProviderAttempts: 1 },
      }),
    ).toMatchObject({ ok: true });
    const afterRestart = new PostgresEvidenceBudgetRepository(test.db);
    expect(
      await afterRestart.reserve({ ...input, reservationId: "reservation_00000000002" }),
    ).toMatchObject({ ok: false });
    expect(await afterRestart.get(caseId)).toMatchObject({
      unknownUsage: true,
      actual: { providerAttempts: 1 },
    });
    await test.db.destroy();
  });
  it("counts known usage and rejects corrupt replay rather than resetting counters", async () => {
    const test = fixture();
    const repo = new PostgresEvidenceBudgetRepository(test.db);
    await repo.reserve({
      operationKind: "provider_request",
      caseId,
      reservationId: "reservation_00000000001",
      model: "gpt-5.6-terra",
      maximumProviderAttempts: 1,
      maximumInputTokens: 200_000,
      maximumOutputAndReasoningTokens: 24_000,
    });
    await repo.reconcile({
      reservationId: "reservation_00000000001",
      usage: {
        kind: "known",
        actualProviderAttempts: 1,
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 20,
        reasoningTokens: 10,
      },
    });
    expect(await repo.get(caseId)).toMatchObject({
      actual: { inputTokens: 100, outputAndReasoningTokens: 30 },
    });
    test.setEvents({ corrupt: true });
    await expect(repo.get(caseId)).rejects.toThrow();
    await test.db.destroy();
  });
});
