import { sql, type Kysely } from "kysely";
import { z } from "zod";
import {
  InMemoryEvidenceBudgetRepository,
  type EvidenceBudgetRepository,
  type ReserveEvidenceBudgetInput,
  type ReconcileEvidenceBudgetInput,
} from "@/application/analysis-budget";
import type { RentProofDatabase } from "./database";

const integer = z.number().int().nonnegative().safe();
const id = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
const ReserveSchema = z
  .object({
    operationKind: z.literal("provider_request"),
    caseId: id,
    reservationId: id,
    model: z.literal("gpt-5.6-terra"),
    maximumProviderAttempts: integer.min(1),
    maximumInputTokens: integer,
    maximumOutputAndReasoningTokens: integer,
  })
  .strict();
const ReconcileSchema = z
  .object({
    reservationId: id,
    usage: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("unknown"), actualProviderAttempts: integer.min(1) }).strict(),
      z
        .object({
          kind: z.literal("known"),
          actualProviderAttempts: integer.min(1),
          inputTokens: integer,
          cachedInputTokens: integer,
          outputTokens: integer,
          reasoningTokens: integer,
        })
        .strict(),
    ]),
  })
  .strict();
const EventsSchema = z
  .array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("reserve"), at: z.iso.datetime(), input: ReserveSchema }).strict(),
      z
        .object({ type: z.literal("reconcile"), at: z.iso.datetime(), input: ReconcileSchema })
        .strict(),
    ]),
  )
  .max(64);
type Events = z.infer<typeof EventsSchema>;

/** Bounded event replay preserves the existing budget semantics under a PostgreSQL row lock. */
export class PostgresEvidenceBudgetRepository implements EvidenceBudgetRepository {
  constructor(private readonly database: Kysely<RentProofDatabase>) {}
  async reserve(input: ReserveEvidenceBudgetInput) {
    if (input.operationKind !== "provider_request")
      return { ok: true as const, metered: false as const, operationKind: input.operationKind };
    const parsed = ReserveSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, code: "EVIDENCE_BUDGET_INVALID_USAGE" as const };
    return this.mutate(input.caseId, async (engine, events, now) => {
      const result = await engine.reserve(parsed.data);
      if (result.ok && result.metered)
        events.push({ type: "reserve", at: now, input: parsed.data });
      return result;
    });
  }
  async reconcile(input: ReconcileEvidenceBudgetInput) {
    const parsed = ReconcileSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, code: "EVIDENCE_BUDGET_INVALID_USAGE" as const };
    const match = await this.database
      .selectFrom("case_evidence_budgets")
      .select("case_id")
      .where(
        sql<boolean>`events @> ${JSON.stringify([{ type: "reserve", input: { reservationId: input.reservationId } }])}::jsonb`,
      )
      .executeTakeFirst();
    if (!match)
      return { ok: false as const, code: "EVIDENCE_BUDGET_RESERVATION_NOT_FOUND" as const };
    return this.mutate(match.case_id, async (engine, events, now) => {
      const result = await engine.reconcile(parsed.data);
      if (result.ok) events.push({ type: "reconcile", at: now, input: parsed.data });
      return result;
    });
  }
  async get(caseId: string) {
    const row = await this.database
      .selectFrom("case_evidence_budgets")
      .select("events")
      .where("case_id", "=", caseId)
      .executeTakeFirst();
    if (!row) return null;
    const events = EventsSchema.parse(row.events);
    const engine = await replay(events, caseId, new Date().toISOString());
    return engine.get(caseId);
  }
  private async mutate<T>(
    caseId: string,
    operation: (
      engine: InMemoryEvidenceBudgetRepository,
      events: Events,
      now: string,
    ) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction().execute(async (db) => {
      await db
        .insertInto("case_evidence_budgets")
        .values({ case_id: caseId, events: JSON.stringify([]) })
        .onConflict((conflict) => conflict.column("case_id").doNothing())
        .execute();
      const row = await db
        .selectFrom("case_evidence_budgets")
        .select("events")
        .where("case_id", "=", caseId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const events = EventsSchema.parse(row.events);
      const now = new Date().toISOString();
      const engine = await replay(events, caseId, now);
      const result = await operation(engine, events, now);
      EventsSchema.parse(events);
      await db
        .updateTable("case_evidence_budgets")
        .set({ events: JSON.stringify(events) })
        .where("case_id", "=", caseId)
        .execute();
      return result;
    });
  }
}

async function replay(events: Events, caseId: string, now: string) {
  let timestamp = now;
  const engine = new InMemoryEvidenceBudgetRepository({ now: () => new Date(timestamp) });
  for (const event of events) {
    timestamp = event.at;
    if (event.type === "reserve" && event.input.caseId !== caseId)
      throw new Error("EVIDENCE_BUDGET_STATE_INVALID");
    const result =
      event.type === "reserve"
        ? await engine.reserve(event.input)
        : await engine.reconcile(event.input);
    if (!result.ok) throw new Error("EVIDENCE_BUDGET_STATE_INVALID");
  }
  timestamp = now;
  return engine;
}
