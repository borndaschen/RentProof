import { MaterialCandidatePayloadSchema, PendingConfirmationSchema } from "@/domain/conversation";
import { canonicalizeCandidatePayload } from "./canonical-payload";
import { PendingConfirmationIntegrityError } from "./errors";
import type {
  ConsumePendingConfirmationInput,
  ConsumePendingConfirmationResult,
  PendingConfirmationEntry,
  PendingConfirmationRepository,
} from "./ports";
import { validatePendingConfirmationEntry } from "./ports";

function cloneEntry(entry: PendingConfirmationEntry): PendingConfirmationEntry {
  return {
    record: structuredClone(entry.record),
    candidate: structuredClone(entry.candidate),
  };
}

function validateEntryIntegrity(entry: PendingConfirmationEntry): PendingConfirmationEntry {
  const validated = validatePendingConfirmationEntry(entry);
  const canonical = canonicalizeCandidatePayload(validated.candidate);

  if (validated.record.candidateType !== canonical.payload.candidateType) {
    throw new PendingConfirmationIntegrityError(
      "The confirmation candidate type does not match its typed payload.",
    );
  }

  if (validated.record.canonicalPayloadHash !== canonical.sha256) {
    throw new PendingConfirmationIntegrityError(
      "The confirmation payload hash does not match its typed payload.",
    );
  }

  if (validated.record.status === "pending" && validated.record.consumedAt !== null) {
    throw new PendingConfirmationIntegrityError(
      "A pending confirmation cannot have a consumed timestamp.",
    );
  }

  if (validated.record.status === "consumed" && validated.record.consumedAt === null) {
    throw new PendingConfirmationIntegrityError(
      "A consumed confirmation must have a consumed timestamp.",
    );
  }

  return cloneEntry(validated);
}

export class InMemoryPendingConfirmationRepository implements PendingConfirmationRepository {
  readonly #entries = new Map<string, PendingConfirmationEntry>();

  async insert(entry: PendingConfirmationEntry): Promise<"inserted" | "conflict"> {
    const validated = validateEntryIntegrity(entry);
    const key = validated.record.confirmationIdHash;

    if (this.#entries.has(key)) {
      return "conflict";
    }

    this.#entries.set(key, validated);
    return "inserted";
  }

  async consume(input: ConsumePendingConfirmationInput): Promise<ConsumePendingConfirmationResult> {
    const stored = this.#entries.get(input.confirmationIdHash);
    if (stored === undefined) {
      return { ok: false, code: "CONFIRMATION_NOT_FOUND" };
    }

    const entry = validateEntryIntegrity(stored);
    const { record } = entry;

    if (record.actorRef !== input.binding.actorRef) {
      return { ok: false, code: "CONFIRMATION_ACTOR_MISMATCH" };
    }

    if (record.status === "consumed") {
      return { ok: false, code: "CONFIRMATION_ALREADY_USED" };
    }

    if (record.status === "revoked") {
      return { ok: false, code: "CONFIRMATION_STALE" };
    }

    if (input.now.getTime() >= Date.parse(record.expiresAt)) {
      return { ok: false, code: "CONFIRMATION_EXPIRED" };
    }

    if (
      record.caseId !== input.binding.caseId ||
      record.caseRevision !== input.binding.caseRevision ||
      record.candidateType !== input.binding.candidateType ||
      record.canonicalPayloadHash !== input.binding.canonicalPayloadHash
    ) {
      return { ok: false, code: "CONFIRMATION_STALE" };
    }

    const consumedRecord = PendingConfirmationSchema.parse({
      ...record,
      status: "consumed",
      consumedAt: input.now.toISOString(),
    });
    const consumedEntry = validateEntryIntegrity({
      record: consumedRecord,
      candidate: MaterialCandidatePayloadSchema.parse(entry.candidate),
    });

    // No await occurs between the final validation and this mutation. Within one
    // JavaScript process this compare-and-set is atomic for competing consumers.
    this.#entries.set(input.confirmationIdHash, consumedEntry);
    return { ok: true, entry: cloneEntry(consumedEntry) };
  }

  async revokeByIdHash(confirmationIdHash: string): Promise<boolean> {
    const stored = this.#entries.get(confirmationIdHash);
    if (stored === undefined || stored.record.status !== "pending") {
      return false;
    }

    const revoked = validateEntryIntegrity({
      record: PendingConfirmationSchema.parse({
        ...stored.record,
        status: "revoked",
        consumedAt: null,
      }),
      candidate: stored.candidate,
    });
    this.#entries.set(confirmationIdHash, revoked);
    return true;
  }
}
