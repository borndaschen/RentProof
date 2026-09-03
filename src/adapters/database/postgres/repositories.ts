import { z } from "zod";
import type { Kysely } from "kysely";
import { OpaqueIdSchema } from "@/domain/conversation";
import {
  ActorContextSchema,
  ConsentPreferenceInputSchema,
  DeletionRequestInputSchema,
  PolicyEventInputSchema,
  SecurityAuditEventInputSchema,
  type ActorContext,
  type CaseStateRepository,
  type ConsentPreferenceInput,
  type CreateCaseStateResult,
  type DeletionRepository,
  type DeletionRequestInput,
  type PolicyEventInput,
  type PolicyRecordRepository,
  type RequestCaseDeletionResult,
  type SaveCaseStateResult,
  type SecurityAuditEventInput,
  type SecurityAuditRepository,
  type VersionedCaseState,
} from "@/application/repositories";
import type { RentProofDatabase } from "./database";

export type PostgresRepositoryErrorCode =
  | "POSTGRES_REPOSITORY_INPUT_INVALID"
  | "POSTGRES_NOT_FOUND_OR_FORBIDDEN"
  | "POSTGRES_STORED_STATE_INVALID";

export class PostgresRepositoryError extends Error {
  override readonly name = "PostgresRepositoryError";
  readonly code: PostgresRepositoryErrorCode;

  constructor(code: PostgresRepositoryErrorCode) {
    super(code);
    this.code = code;
  }
}

export class PostgresCaseStateRepository<TState> implements CaseStateRepository<TState> {
  readonly #database: Kysely<RentProofDatabase>;
  readonly #stateSchema: z.ZodType<TState>;
  readonly #sourceMode: "fixture" | "live";

  constructor(
    database: Kysely<RentProofDatabase>,
    stateSchema: z.ZodType<TState>,
    sourceMode: "fixture" | "live",
  ) {
    this.#database = database;
    this.#stateSchema = stateSchema;
    this.#sourceMode = sourceMode;
  }

  async create(actor: ActorContext, caseId: string, state: TState): Promise<CreateCaseStateResult> {
    const parsed = parseCaseInputs(actor, caseId, state, this.#stateSchema);
    const result = await this.#database
      .insertInto("rental_cases")
      .values({
        id: parsed.caseId,
        owner_type: parsed.actor.kind,
        owner_subject_id: actorSubject(parsed.actor),
        display_name: "租屋案件",
        status: "draft",
        revision: 0,
        active_snapshot_id: null,
        state: parsed.state,
        source_mode: this.#sourceMode,
        deleted_at: null,
      })
      .onConflict((conflict) => conflict.column("id").doNothing())
      .returning("revision")
      .executeTakeFirst();
    return result ? { status: "created", revision: 0 } : { status: "case_id_unavailable" };
  }

  async load(actor: ActorContext, caseId: string): Promise<VersionedCaseState<TState> | null> {
    const parsedActor = parseActor(actor);
    const parsedCaseId = parseCaseId(caseId);
    const row = await ownedCaseQuery(this.#database, parsedActor, parsedCaseId)
      .select(["id", "revision", "state"])
      .executeTakeFirst();
    if (!row) return null;
    const state = this.#stateSchema.safeParse(row.state);
    if (!state.success) {
      throw new PostgresRepositoryError("POSTGRES_STORED_STATE_INVALID");
    }
    return { caseId: row.id, revision: row.revision, state: state.data };
  }

  async saveAtomic(
    actor: ActorContext,
    caseId: string,
    expectedRevision: number,
    state: TState,
  ): Promise<SaveCaseStateResult> {
    const parsed = parseCaseInputs(actor, caseId, state, this.#stateSchema);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");
    }
    const result = await this.#database
      .updateTable("rental_cases")
      .set({
        state: parsed.state,
        revision: expectedRevision + 1,
        updated_at: new Date(),
      })
      .where("id", "=", parsed.caseId)
      .where("owner_type", "=", parsed.actor.kind)
      .where("owner_subject_id", "=", actorSubject(parsed.actor))
      .where("deleted_at", "is", null)
      .where("revision", "=", expectedRevision)
      .returning("revision")
      .executeTakeFirst();
    if (result) return { status: "saved", revision: result.revision };

    const visible = await ownedCaseQuery(this.#database, parsed.actor, parsed.caseId)
      .select("revision")
      .executeTakeFirst();
    return visible ? { status: "revision_conflict" } : { status: "not_found_or_forbidden" };
  }
}

export class PostgresPolicyRecordRepository implements PolicyRecordRepository {
  readonly #database: Kysely<RentProofDatabase>;

  constructor(database: Kysely<RentProofDatabase>) {
    this.#database = database;
  }

  async appendPolicyEvent(actor: ActorContext, input: PolicyEventInput): Promise<void> {
    const parsedActor = parseActor(actor);
    const parsed = PolicyEventInputSchema.safeParse(input);
    if (!parsed.success) throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");

    await this.#database.transaction().execute(async (transaction) => {
      const publishedPolicy = await transaction
        .selectFrom("policy_documents")
        .select("id")
        .where("id", "=", parsed.data.policyDocumentId)
        .where("status", "=", "published")
        .executeTakeFirst();
      if (!publishedPolicy) {
        throw new PostgresRepositoryError("POSTGRES_NOT_FOUND_OR_FORBIDDEN");
      }
      if (parsed.data.caseId) {
        const owned = await ownedCaseQuery(transaction, parsedActor, parsed.data.caseId)
          .select("id")
          .executeTakeFirst();
        if (!owned) throw new PostgresRepositoryError("POSTGRES_NOT_FOUND_OR_FORBIDDEN");
      }
      await transaction
        .insertInto("policy_events")
        .values({
          id: parsed.data.eventId,
          actor_type: parsedActor.kind,
          actor_subject_id: actorSubject(parsedActor),
          policy_document_id: parsed.data.policyDocumentId,
          event_type: parsed.data.eventType,
          occurred_at: parsed.data.occurredAt,
          source_route: parsed.data.sourceRoute,
          case_id: parsed.data.caseId ?? null,
          analysis_run_id: parsed.data.analysisRunId ?? null,
          processor_list_version: parsed.data.processorListVersion ?? null,
          audit_ref: parsed.data.auditRef,
        })
        .executeTakeFirstOrThrow();
    });
  }

  async saveConsentPreference(actor: ActorContext, input: ConsentPreferenceInput): Promise<void> {
    const parsedActor = parseActor(actor);
    const parsed = ConsentPreferenceInputSchema.safeParse(input);
    if (!parsed.success) throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");
    await this.#database
      .insertInto("consent_preferences")
      .values({
        actor_type: parsedActor.kind,
        actor_subject_id: actorSubject(parsedActor),
        purpose_key: parsed.data.purposeKey,
        decision: parsed.data.decision,
        cookie_policy_version: parsed.data.cookiePolicyVersion,
        inventory_version: parsed.data.inventoryVersion,
        occurred_at: parsed.data.occurredAt,
      })
      .onConflict((conflict) =>
        conflict.columns(["actor_type", "actor_subject_id", "purpose_key"]).doUpdateSet({
          decision: parsed.data.decision,
          cookie_policy_version: parsed.data.cookiePolicyVersion,
          inventory_version: parsed.data.inventoryVersion,
          occurred_at: parsed.data.occurredAt,
        }),
      )
      .executeTakeFirstOrThrow();
  }
}

export class PostgresDeletionRepository implements DeletionRepository {
  readonly #database: Kysely<RentProofDatabase>;

  constructor(database: Kysely<RentProofDatabase>) {
    this.#database = database;
  }

  async requestCaseDeletion(
    actor: ActorContext,
    input: DeletionRequestInput,
  ): Promise<RequestCaseDeletionResult> {
    const parsedActor = parseActor(actor);
    const parsed = DeletionRequestInputSchema.safeParse(input);
    if (!parsed.success) throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");

    return this.#database.transaction().execute(async (transaction) => {
      const owned = await ownedCaseQuery(transaction, parsedActor, parsed.data.caseId)
        .select(["id", "status"])
        .forUpdate()
        .executeTakeFirst();
      if (!owned) return { status: "not_found_or_forbidden" };
      if (owned.status === "deletion_pending") return { status: "already_pending" };

      const inserted = await transaction
        .insertInto("deletion_requests")
        .values({
          id: parsed.data.deletionRequestId,
          target_type: "case",
          target_id: parsed.data.caseId,
          requested_by_type: parsedActor.kind,
          requested_by_subject_id: actorSubject(parsedActor),
          status: "pending",
          requested_at: parsed.data.requestedAt,
          purge_deadline: parsed.data.purgeDeadline,
          completed_at: null,
          correlation_id: parsed.data.correlationId,
        })
        .onConflict((conflict) => conflict.columns(["target_type", "target_id"]).doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!inserted) return { status: "already_pending" };

      await transaction
        .updateTable("rental_cases")
        .set({ status: "deletion_pending", updated_at: new Date() })
        .where("id", "=", parsed.data.caseId)
        .where("owner_type", "=", parsedActor.kind)
        .where("owner_subject_id", "=", actorSubject(parsedActor))
        .executeTakeFirstOrThrow();
      return { status: "accepted" };
    });
  }
}

export class PostgresSecurityAuditRepository implements SecurityAuditRepository {
  readonly #database: Kysely<RentProofDatabase>;

  constructor(database: Kysely<RentProofDatabase>) {
    this.#database = database;
  }

  async appendSecurityEvent(input: SecurityAuditEventInput): Promise<void> {
    const parsed = SecurityAuditEventInputSchema.safeParse(input);
    if (!parsed.success) throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");
    await this.#database
      .insertInto("security_audit_events")
      .values({
        id: parsed.data.eventId,
        event_type: parsed.data.eventType,
        occurred_at: parsed.data.occurredAt,
        outcome: parsed.data.outcome,
        reason_code: parsed.data.reasonCode,
        correlation_id: parsed.data.correlationId,
        actor_ref: parsed.data.actorRef ?? null,
        target_ref: parsed.data.targetRef ?? null,
        provider_ref: parsed.data.providerRef ?? null,
      })
      .executeTakeFirstOrThrow();
  }
}

function parseActor(actor: ActorContext): ActorContext {
  const parsed = ActorContextSchema.safeParse(actor);
  if (!parsed.success) throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");
  return parsed.data;
}

function parseCaseId(caseId: string): string {
  const parsed = OpaqueIdSchema.safeParse(caseId);
  if (!parsed.success) throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");
  return parsed.data;
}

function parseCaseInputs<TState>(
  actor: ActorContext,
  caseId: string,
  state: TState,
  schema: z.ZodType<TState>,
): { actor: ActorContext; caseId: string; state: TState } {
  const parsedState = schema.safeParse(state);
  if (!parsedState.success) throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");
  return { actor: parseActor(actor), caseId: parseCaseId(caseId), state: parsedState.data };
}

function actorSubject(actor: ActorContext): string {
  return actor.kind === "user" ? actor.userId : actor.guestId;
}

function ownedCaseQuery(database: Kysely<RentProofDatabase>, actor: ActorContext, caseId: string) {
  return database
    .selectFrom("rental_cases")
    .where("id", "=", caseId)
    .where("owner_type", "=", actor.kind)
    .where("owner_subject_id", "=", actorSubject(actor))
    .where("deleted_at", "is", null);
}
