import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApplyMaterialCandidateUseCase } from "@/application/case-commands/apply-material-candidate";
import { ActorContextSchema, actorOwnsCase } from "@/application/case-commands/contracts";
import type { ActorContext } from "@/application/case-commands/contracts";
import type { SingleCaseRepository } from "@/application/case-commands/ports";
import { MaterialCandidatePayloadSchema } from "@/domain/conversation/candidate";
import type { MaterialCandidatePayload } from "@/domain/conversation/candidate";
import { CONVERSATION_LIMITS } from "@/domain/conversation/constants";
import { OpaqueIdSchema } from "@/domain/conversation/primitives";
import { canonicalCandidate, hashConfirmationId } from "./hashing";

export interface MaterialConfirmationClock {
  now(): Date;
}

export interface MaterialConfirmationIdGenerator {
  nextId(): string;
}

const IssueCommandSchema = z
  .object({
    actor: ActorContextSchema,
    caseId: OpaqueIdSchema,
    candidate: MaterialCandidatePayloadSchema,
  })
  .strict();

const ConsumeCommandSchema = z
  .object({
    confirmationId: OpaqueIdSchema,
    actor: ActorContextSchema,
    caseId: OpaqueIdSchema,
  })
  .strict();

type StoredConfirmation = {
  confirmationIdHash: string;
  actorBindingHash: string;
  caseId: string;
  caseRevision: number;
  candidateType: MaterialCandidatePayload["candidateType"];
  payloadHash: string;
  candidate: MaterialCandidatePayload;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "used";
};

export type IssueMaterialConfirmationResult =
  | Readonly<{
      ok: true;
      confirmationId: string;
      expiresAt: string;
      candidate: MaterialCandidatePayload;
      caseRevision: number;
    }>
  | Readonly<{
      ok: false;
      code:
        | "CONFIRMATION_REQUEST_INVALID"
        | "CASE_NOT_FOUND_OR_FORBIDDEN"
        | "CONFIRMATION_ID_CONFLICT"
        | "CONFIRMATION_CAPACITY_EXCEEDED";
    }>;

export type ConsumeMaterialConfirmationResult =
  | Readonly<{ ok: true; revision: number }>
  | Readonly<{
      ok: false;
      code:
        | "CONFIRMATION_REQUEST_INVALID"
        | "CONFIRMATION_NOT_FOUND"
        | "CONFIRMATION_ACTOR_MISMATCH"
        | "CONFIRMATION_STALE"
        | "CONFIRMATION_EXPIRED"
        | "CONFIRMATION_ALREADY_USED"
        | "CASE_REPOSITORY_FAILED";
    }>;

type ServiceDependencies = Readonly<{
  repository: SingleCaseRepository;
  applyCandidate: ApplyMaterialCandidateUseCase;
  clock: MaterialConfirmationClock;
  idGenerator: MaterialConfirmationIdGenerator;
}>;

function actorBindingHash(actor: ActorContext): string {
  const canonical =
    actor.kind === "guest"
      ? JSON.stringify({
          guestId: actor.guestId,
          guestSessionId: actor.guestSessionId,
          kind: actor.kind,
        })
      : JSON.stringify({ kind: actor.kind, sessionId: actor.sessionId, userId: actor.userId });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export class MaterialConfirmationService {
  readonly #confirmations = new Map<string, StoredConfirmation>();

  constructor(private readonly dependencies: ServiceDependencies) {}

  async issue(untrustedCommand: unknown): Promise<IssueMaterialConfirmationResult> {
    const parsed = IssueCommandSchema.safeParse(untrustedCommand);
    if (!parsed.success) return { ok: false, code: "CONFIRMATION_REQUEST_INVALID" };
    const command = parsed.data;
    const aggregate = await this.dependencies.repository.load(command.caseId);
    if (aggregate === null || !actorOwnsCase(command.actor, aggregate.owner)) {
      return { ok: false, code: "CASE_NOT_FOUND_OR_FORBIDDEN" };
    }

    const now = this.dependencies.clock.now();
    for (const [key, entry] of this.#confirmations) {
      if (Date.parse(entry.expiresAt) <= now.getTime()) this.#confirmations.delete(key);
    }
    if (this.#confirmations.size >= 100) {
      return { ok: false, code: "CONFIRMATION_CAPACITY_EXCEEDED" };
    }

    const confirmationId = OpaqueIdSchema.parse(this.dependencies.idGenerator.nextId());
    const confirmationIdHash = hashConfirmationId(confirmationId);
    if (this.#confirmations.has(confirmationIdHash)) {
      return { ok: false, code: "CONFIRMATION_ID_CONFLICT" };
    }
    const canonical = canonicalCandidate(command.candidate);
    const expiresAt = new Date(now.getTime() + CONVERSATION_LIMITS.confirmationTtlMs).toISOString();
    this.#confirmations.set(confirmationIdHash, {
      confirmationIdHash,
      actorBindingHash: actorBindingHash(command.actor),
      caseId: command.caseId,
      caseRevision: aggregate.revision,
      candidateType: canonical.payload.candidateType,
      payloadHash: canonical.sha256,
      candidate: structuredClone(canonical.payload),
      createdAt: now.toISOString(),
      expiresAt,
      status: "pending",
    });
    return {
      ok: true,
      confirmationId,
      expiresAt,
      candidate: structuredClone(canonical.payload),
      caseRevision: aggregate.revision,
    };
  }

  async consume(untrustedCommand: unknown): Promise<ConsumeMaterialConfirmationResult> {
    const parsed = ConsumeCommandSchema.safeParse(untrustedCommand);
    if (!parsed.success) return { ok: false, code: "CONFIRMATION_REQUEST_INVALID" };
    const command = parsed.data;
    const key = hashConfirmationId(command.confirmationId);
    const initial = this.#confirmations.get(key);
    if (initial === undefined) return { ok: false, code: "CONFIRMATION_NOT_FOUND" };
    if (initial.actorBindingHash !== actorBindingHash(command.actor)) {
      return { ok: false, code: "CONFIRMATION_ACTOR_MISMATCH" };
    }
    if (initial.caseId !== command.caseId) return { ok: false, code: "CONFIRMATION_STALE" };
    if (initial.status === "used") return { ok: false, code: "CONFIRMATION_ALREADY_USED" };
    if (this.dependencies.clock.now().getTime() >= Date.parse(initial.expiresAt)) {
      return { ok: false, code: "CONFIRMATION_EXPIRED" };
    }

    const canonical = canonicalCandidate(initial.candidate);
    if (
      canonical.sha256 !== initial.payloadHash ||
      canonical.payload.candidateType !== initial.candidateType
    ) {
      return { ok: false, code: "CONFIRMATION_STALE" };
    }

    // Re-check after the async boundary so competing consumes cannot both win.
    const current = this.#confirmations.get(key);
    if (current === undefined) return { ok: false, code: "CONFIRMATION_NOT_FOUND" };
    if (current.status === "used") return { ok: false, code: "CONFIRMATION_ALREADY_USED" };
    current.status = "used";

    const applied = await this.dependencies.applyCandidate.execute({
      actor: command.actor,
      caseId: command.caseId,
      expectedRevision: current.caseRevision,
      candidate: structuredClone(current.candidate),
    });
    if (!applied.ok) {
      if (applied.code === "CASE_REPOSITORY_FAILED") {
        return { ok: false, code: "CASE_REPOSITORY_FAILED" };
      }
      return { ok: false, code: "CONFIRMATION_STALE" };
    }
    return { ok: true, revision: applied.aggregate.revision };
  }
}
