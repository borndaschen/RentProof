import { z } from "zod";
import { OpaqueIdSchema } from "@/domain/conversation";
import {
  ActorContextSchema,
  CaseOwnerSchema,
  actorOwnsCase,
  ownerFromActor,
  type ActorContext,
  type CaseStateRepository,
  type CreateCaseStateResult,
  type JsonStateFilesystemPort,
  type SaveCaseStateResult,
  type VersionedCaseState,
} from "@/application/repositories";

export type JsonCaseStateRepositoryErrorCode =
  "JSON_STATE_SCHEMA_INVALID" | "JSON_STATE_INPUT_INVALID";

export class JsonCaseStateRepositoryError extends Error {
  override readonly name = "JsonCaseStateRepositoryError";
  readonly code: JsonCaseStateRepositoryErrorCode;

  constructor(code: JsonCaseStateRepositoryErrorCode) {
    super(code);
    this.code = code;
  }
}

export class JsonCaseStateRepository<TState> implements CaseStateRepository<TState> {
  readonly #filesystem: JsonStateFilesystemPort;
  readonly #stateSchema: z.ZodType<TState>;
  readonly #envelopeSchema: z.ZodType<{
    schemaVersion: "rentproof.case-state-envelope.v1";
    caseId: string;
    owner: z.infer<typeof CaseOwnerSchema>;
    revision: number;
    state: TState;
  }>;

  constructor(filesystem: JsonStateFilesystemPort, stateSchema: z.ZodType<TState>) {
    this.#filesystem = filesystem;
    this.#stateSchema = stateSchema;
    this.#envelopeSchema = z
      .object({
        schemaVersion: z.literal("rentproof.case-state-envelope.v1"),
        caseId: OpaqueIdSchema,
        owner: CaseOwnerSchema,
        revision: z.number().int().nonnegative(),
        state: stateSchema,
      })
      .strict();
  }

  async create(
    untrustedActor: ActorContext,
    untrustedCaseId: string,
    untrustedState: TState,
  ): Promise<CreateCaseStateResult> {
    const { actor, caseId, state } = this.#parseInputs(
      untrustedActor,
      untrustedCaseId,
      untrustedState,
    );
    const envelope = this.#envelopeSchema.parse({
      schemaVersion: "rentproof.case-state-envelope.v1",
      caseId,
      owner: ownerFromActor(actor),
      revision: 0,
      state,
    });
    const created = await this.#filesystem.writeTextIfUnchanged(
      storageKey(caseId),
      null,
      serialize(envelope),
    );
    return created ? { status: "created", revision: 0 } : { status: "case_id_unavailable" };
  }

  async load(
    untrustedActor: ActorContext,
    untrustedCaseId: string,
  ): Promise<VersionedCaseState<TState> | null> {
    const actor = parseActor(untrustedActor);
    const caseId = parseCaseId(untrustedCaseId);
    const raw = await this.#filesystem.readText(storageKey(caseId));
    if (raw === null) {
      return null;
    }
    const envelope = this.#parseStored(raw);
    if (envelope.caseId !== caseId || !actorOwnsCase(actor, envelope.owner)) {
      return null;
    }
    return { caseId: envelope.caseId, revision: envelope.revision, state: envelope.state };
  }

  async saveAtomic(
    untrustedActor: ActorContext,
    untrustedCaseId: string,
    expectedRevision: number,
    untrustedState: TState,
  ): Promise<SaveCaseStateResult> {
    const { actor, caseId, state } = this.#parseInputs(
      untrustedActor,
      untrustedCaseId,
      untrustedState,
    );
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new JsonCaseStateRepositoryError("JSON_STATE_INPUT_INVALID");
    }
    const key = storageKey(caseId);
    const raw = await this.#filesystem.readText(key);
    if (raw === null) {
      return { status: "not_found_or_forbidden" };
    }
    const envelope = this.#parseStored(raw);
    if (envelope.caseId !== caseId || !actorOwnsCase(actor, envelope.owner)) {
      return { status: "not_found_or_forbidden" };
    }
    if (envelope.revision !== expectedRevision) {
      return { status: "revision_conflict" };
    }

    const nextRevision = expectedRevision + 1;
    const next = this.#envelopeSchema.parse({ ...envelope, revision: nextRevision, state });
    const saved = await this.#filesystem.writeTextIfUnchanged(key, raw, serialize(next));
    return saved ? { status: "saved", revision: nextRevision } : { status: "revision_conflict" };
  }

  #parseInputs(
    untrustedActor: ActorContext,
    untrustedCaseId: string,
    untrustedState: TState,
  ): { actor: ActorContext; caseId: string; state: TState } {
    try {
      return {
        actor: ActorContextSchema.parse(untrustedActor),
        caseId: OpaqueIdSchema.parse(untrustedCaseId),
        state: this.#stateSchema.parse(untrustedState),
      };
    } catch {
      throw new JsonCaseStateRepositoryError("JSON_STATE_INPUT_INVALID");
    }
  }

  #parseStored(raw: string) {
    try {
      const unknownValue: unknown = JSON.parse(raw);
      return this.#envelopeSchema.parse(unknownValue);
    } catch {
      throw new JsonCaseStateRepositoryError("JSON_STATE_SCHEMA_INVALID");
    }
  }
}

function parseActor(untrustedActor: ActorContext): ActorContext {
  const parsed = ActorContextSchema.safeParse(untrustedActor);
  if (!parsed.success) {
    throw new JsonCaseStateRepositoryError("JSON_STATE_INPUT_INVALID");
  }
  return parsed.data;
}

function parseCaseId(untrustedCaseId: string): string {
  const parsed = OpaqueIdSchema.safeParse(untrustedCaseId);
  if (!parsed.success) {
    throw new JsonCaseStateRepositoryError("JSON_STATE_INPUT_INVALID");
  }
  return parsed.data;
}

function storageKey(caseId: string): string {
  return `cases/${caseId}.json`;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}
