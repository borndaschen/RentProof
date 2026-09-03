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
const guestActor = {
  kind: "guest",
  guestId: "guest_abcdefghijklmnopqrstuvwxyz12345",
  guestSessionId: "guest_session_abcdefghijklmnopqrstuv",
} as const satisfies ActorContext;
const otherGuestActor = {
  kind: "guest",
  guestId: "guest_other_abcdefghijklmnopqrstuvwxyz",
  guestSessionId: "guest_session_other_abcdefghijklmnop",
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

  it("isolates guest A from guest B using the database owner scope", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue([], []);

    await expect(repository.deleteCase({ actor: otherGuestActor, caseId, now })).resolves.toBe(
      false,
    );
    const caseQueries = fixture.pool.queries.filter((query) =>
      query.text.includes('"rental_cases"'),
    );
    expect(caseQueries).toHaveLength(2);
    expect(caseQueries.every((query) => query.parameters.includes("guest"))).toBe(true);
    expect(
      caseQueries.every((query) => query.parameters.includes(otherGuestActor.guestSessionId)),
    ).toBe(true);
    expect(
      caseQueries.every((query) => !query.parameters.includes(guestActor.guestSessionId)),
    ).toBe(true);
    await fixture.destroy();
  });

  it("sets a guest deletion deadline to 24 hours instead of the account deadline", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue([{ id: caseId }], [], []);

    await expect(repository.deleteCase({ actor: guestActor, caseId, now })).resolves.toBe(true);
    const deletion = fixture.pool.queries.find((query) =>
      query.text.includes('insert into "deletion_requests"'),
    );
    expect(deletion?.parameters).toContain(guestActor.guestSessionId);
    expect(
      deletion?.parameters.some(
        (value) =>
          value instanceof Date && value.getTime() === Date.parse("2026-09-04T12:00:00.000Z"),
      ),
    ).toBe(true);
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

  it("atomically transfers a live guest case and every artifact to a recently verified user", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue(
      [{ id: guestActor.guestSessionId }],
      [{ id: actor.sessionId }],
      [{ owner_type: "guest", owner_subject_id: guestActor.guestSessionId, deleted_at: null }],
      [],
      [{ id: caseId }],
      [],
    );
    await expect(
      repository.transferGuestCase({ guest: guestActor, user: actor, caseId, now }),
    ).resolves.toBe("transferred");
    const updates = fixture.pool.queries.filter((query) => /^update /iu.test(query.text.trim()));
    expect(updates.some((query) => query.text.includes('"case_artifacts"'))).toBe(true);
    expect(updates.some((query) => query.text.includes('"rental_cases"'))).toBe(true);
    expect(
      fixture.pool.queries.some((query) => query.text.includes('"security_audit_events"')),
    ).toBe(true);
    await fixture.destroy();
  });

  it("does not reveal a case when either transfer session is no longer valid", async () => {
    const fixture = createDatabaseFixture();
    const repository = new PostgresRealDemoRepository(fixture.database);
    fixture.pool.enqueue([], [{ id: actor.sessionId }]);
    await expect(
      repository.transferGuestCase({ guest: guestActor, user: actor, caseId, now }),
    ).resolves.toBe("not_found_or_forbidden");
    expect(fixture.pool.queries.some((query) => query.text.includes('update "rental_cases"'))).toBe(
      false,
    );
    await fixture.destroy();
  });

  it("loads an owner-scoped conversation context including a confirmed listing URL", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue(
      [
        {
          revision: 3,
          status: "draft",
          state: {
            listingUrlSource: {
              sourceUrl: "https://rent.example/item/1",
              text: "月租 12000 元",
              contentHash: "a".repeat(64),
            },
          },
        },
      ],
      [{ artifact_kind: "contract_pdf" }],
    );
    await expect(repositoryFor(fixture).getConversationContext({ actor, caseId })).resolves.toEqual(
      {
        revision: 3,
        status: "draft",
        artifactKinds: ["contract_pdf"],
        listingUrlAvailable: true,
      },
    );
    await fixture.destroy();
  });

  it("stores listing URL text with owner and revision compare-and-swap", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue(
      [{ revision: 2, state: { schemaVersion: "rentproof.real-case-state.v1" } }],
      [{ id: caseId }],
    );
    await expect(
      repositoryFor(fixture).saveListingUrlSource({
        actor,
        caseId,
        expectedRevision: 2,
        sourceUrl: "https://rent.example/item/1",
        text: "月租 12000 元",
        contentHash: "a".repeat(64),
        now,
      }),
    ).resolves.toBe("saved");
    const update = fixture.pool.queries.find((query) =>
      query.text.includes('update "rental_cases"'),
    );
    expect(update?.parameters).toContain(actor.userId);
    expect(update?.parameters).toContain(2);
    await fixture.destroy();
  });

  it("reads only a valid listing URL source from the owned case state", async () => {
    const fixture = createDatabaseFixture();
    fixture.pool.enqueue([
      {
        state: {
          listingUrlSource: {
            sourceUrl: "https://rent.example/1",
            text: "租金",
            contentHash: "b".repeat(64),
          },
        },
      },
    ]);
    await expect(repositoryFor(fixture).getListingUrlSource({ actor, caseId })).resolves.toEqual({
      sourceUrl: "https://rent.example/1",
      text: "租金",
      contentHash: "b".repeat(64),
    });
    await fixture.destroy();
  });

  it("fails closed for stale or missing listing URL compare-and-swap state", async () => {
    const staleFixture = createDatabaseFixture();
    staleFixture.pool.enqueue([{ revision: 3, state: {} }]);
    await expect(
      repositoryFor(staleFixture).saveListingUrlSource({
        actor,
        caseId,
        expectedRevision: 2,
        sourceUrl: "https://rent.example/1",
        text: "租金",
        contentHash: "c".repeat(64),
        now,
      }),
    ).resolves.toBe("stale");
    await staleFixture.destroy();

    const missingFixture = createDatabaseFixture();
    missingFixture.pool.enqueue([]);
    await expect(
      repositoryFor(missingFixture).saveListingUrlSource({
        actor,
        caseId,
        expectedRevision: 2,
        sourceUrl: "https://rent.example/1",
        text: "租金",
        contentHash: "c".repeat(64),
        now,
      }),
    ).resolves.toBe("not_found_or_forbidden");
    await missingFixture.destroy();
  });

  it("returns no listing source for missing or malformed state", async () => {
    const malformed = createDatabaseFixture();
    malformed.pool.enqueue([{ state: { listingUrlSource: { sourceUrl: "http://private/" } } }]);
    await expect(
      repositoryFor(malformed).getListingUrlSource({ actor, caseId }),
    ).resolves.toBeNull();
    await malformed.destroy();
    const missing = createDatabaseFixture();
    missing.pool.enqueue([]);
    await expect(repositoryFor(missing).getListingUrlSource({ actor, caseId })).resolves.toBeNull();
    await missing.destroy();
  });
});

function repositoryFor(fixture: ReturnType<typeof createDatabaseFixture>) {
  return new PostgresRealDemoRepository(fixture.database);
}

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
