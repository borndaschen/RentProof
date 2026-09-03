import { Kysely, PostgresDialect } from "kysely";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/application/repositories";
import type { RentProofDatabase } from "./database";
import { PostgresRealDemoRepository } from "./real-demo-repository";

const actor = {
  kind: "user",
  userId: "user_abcdefghijklmnopqrstuvwxyz123456",
  sessionId: "session_abcdefghijklmnopqrstuvwxyz123",
} as const satisfies ActorContext;
const otherActor = {
  kind: "user",
  userId: "user_other_abcdefghijklmnopqrstuvwxyz",
  sessionId: "session_other_abcdefghijklmnopqrstuv",
} as const satisfies ActorContext;
const caseId = "case_abcdefghijklmnopqrstuvwxyz1234567890";
const now = new Date("2026-09-03T12:00:00.000Z");

describe("PostgresRealDemoRepository", () => {
  it("creates the case and versioned processing consent in one transaction", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue(
      [],
      [{ id: "policy_cloud_processing_demo_v1", content_hash: "a".repeat(64) }],
      [],
      [],
    );
    await expect(
      repository.createCase({
        actor,
        displayName: "測試案件",
        cloudProcessingConsentVersion: "rentproof.cloud-processing-demo.v1",
        cloudProcessingConsentHash: "a".repeat(64),
        now,
      }),
    ).resolves.toMatchObject({ caseId: expect.stringMatching(/^case_[a-f0-9]{48}$/u) });
    expect(fixture.pool.queries.some((query) => query.text.includes('"policy_events"'))).toBe(true);
    expect(fixture.pool.queries.some((query) => query.text.includes('"rental_cases"'))).toBe(true);
    await fixture.destroy();
  });

  it("reserves and finalizes an owner-scoped image artifact", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    const reservation = {
      artifactId: "artifact_abcdefghijklmnopqrstuvwxyz1234567890",
      caseId,
      kind: "listing_image" as const,
      mime: "image/png" as const,
      originalSha256: "a".repeat(64),
      originalBytes: 1024,
    };
    fixture.pool.enqueue([{ id: caseId }], [{ total: "0" }], []);
    await repository.reserveArtifact({ actor, reservation, now });
    fixture.pool.enqueue([{ id: reservation.artifactId }], []);
    await repository.finalizeArtifact({
      actor,
      reservation,
      stored: {
        originalRelativePath: `${caseId}/${reservation.artifactId}/original.enc`,
        derivativeRelativePath: `${caseId}/${reservation.artifactId}/derivative.enc`,
        extractedTextRelativePath: null,
        derivativeSha256: "b".repeat(64),
        derivativeBytes: 512,
      },
      now,
    });
    const artifactQueries = fixture.pool.queries.filter((query) =>
      query.text.includes('"case_artifacts"'),
    );
    expect(artifactQueries.length).toBeGreaterThanOrEqual(3);
    expect(artifactQueries.every((query) => query.parameters.includes(actor.userId))).toBe(true);
    await fixture.destroy();
  });

  it("lists only available artifacts joined to the same owner case", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue([
      {
        artifact_id: "artifact_abcdefghijklmnopqrstuvwxyz1234567890",
        case_id: caseId,
        artifact_kind: "contract_pdf",
        mime: "application/pdf",
        derivative_relative_path: null,
        extracted_text_relative_path: `${caseId}/artifact_abcdefghijklmnopqrstuvwxyz1234567890/extracted-text.enc`,
      },
    ]);
    await expect(repository.listAvailableArtifacts({ actor, caseId })).resolves.toHaveLength(1);
    const query = fixture.pool.queries.find((candidate) =>
      candidate.text.includes('"case_artifacts"'),
    );
    expect(query?.text).toContain('"rental_cases"');
    expect(query?.parameters).toContain(actor.userId);
    await fixture.destroy();
  });

  it("does not reveal another owner's case while beginning deletion", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue([], []);

    await expect(repository.deleteCase({ actor: otherActor, caseId, now })).resolves.toBe(false);
    const caseQueries = fixture.pool.queries.filter((query) =>
      query.text.includes('"rental_cases"'),
    );
    expect(caseQueries).toHaveLength(2);
    expect(caseQueries.every((query) => query.text.includes('"owner_subject_id"'))).toBe(true);
    expect(caseQueries.every((query) => query.parameters.includes(otherActor.userId))).toBe(true);
    expect(fixture.pool.queries.some((query) => query.text.includes('"deletion_requests"'))).toBe(
      false,
    );
    await fixture.destroy();
  });

  it("allows the same owner to retry a case already pending deletion", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue([], [{ id: caseId }]);

    await expect(repository.deleteCase({ actor, caseId, now })).resolves.toBe(true);
    expect(fixture.pool.queries.some((query) => query.text.includes('"case_artifacts"'))).toBe(
      false,
    );
    expect(fixture.pool.queries.some((query) => query.text.includes('"deletion_requests"'))).toBe(
      false,
    );
    await fixture.destroy();
  });

  it("owner-scopes every final purge query and requires the pending records", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue([], [{ id: caseId }], [{ id: "delete_abcdefghijklmnopqrstuv" }]);

    await repository.completeCaseDeletion({ actor, caseId, now });
    const purgeQueries = fixture.pool.queries.filter(
      (query) =>
        query.text.includes('"case_artifacts"') ||
        query.text.includes('"rental_cases"') ||
        query.text.includes('"deletion_requests"'),
    );
    expect(purgeQueries).toHaveLength(3);
    expect(
      purgeQueries.every((query) =>
        query.text.includes('"deletion_requests"')
          ? query.text.includes('"requested_by_subject_id"')
          : query.text.includes('"owner_subject_id"'),
      ),
    ).toBe(true);
    expect(purgeQueries.every((query) => query.parameters.includes(actor.userId))).toBe(true);
    await fixture.destroy();
  });

  it("fails closed when the pending deletion request is missing", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue([], [{ id: caseId }], []);

    await expect(repository.completeCaseDeletion({ actor, caseId, now })).rejects.toThrow(
      "REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN",
    );
    expect(fixture.pool.queries.some((query) => /^rollback$/iu.test(query.text.trim()))).toBe(true);
    await fixture.destroy();
  });
});

type RecordedQuery = { text: string; parameters: readonly unknown[] };

class FakePool {
  readonly queries: RecordedQuery[] = [];
  readonly #responses: QueryResultRow[][] = [];

  enqueue(...rows: QueryResultRow[][]): void {
    this.#responses.push(...rows);
  }

  on(): this {
    return this;
  }

  async connect() {
    return {
      query: async (text: string, parameters: readonly unknown[] = []): Promise<QueryResult> => {
        this.queries.push({ text, parameters });
        const normalized = text.trim().toLowerCase();
        const rows =
          normalized === "begin" || normalized === "commit" || normalized === "rollback"
            ? []
            : (this.#responses.shift() ?? []);
        return {
          command: normalized.split(" ")[0]?.toUpperCase() ?? "UNKNOWN",
          rowCount: rows.length,
          oid: 0,
          fields: [],
          rows,
        };
      },
      release(): void {},
    };
  }

  async end(): Promise<void> {}
}

function createDatabaseFixture(): {
  pool: FakePool;
  database: Kysely<RentProofDatabase>;
  destroy(): Promise<void>;
} {
  const pool = new FakePool();
  const database = new Kysely<RentProofDatabase>({
    dialect: new PostgresDialect({ pool: pool as unknown as Pool }),
  });
  return { pool, database, destroy: () => database.destroy() };
}
