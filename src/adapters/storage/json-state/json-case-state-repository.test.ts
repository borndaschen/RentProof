import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { JsonStateFilesystemPort } from "@/application/repositories";
import {
  JsonCaseStateRepository,
  JsonCaseStateRepositoryError,
} from "./json-case-state-repository";
import { MemoryJsonStateFilesystem } from "./memory-json-state-filesystem";

const CaseStateSchema = z
  .object({
    title: z.string().min(1).max(80),
    phase: z.enum(["listing", "contract", "report_ready"]),
  })
  .strict();

type CaseState = z.infer<typeof CaseStateSchema>;

const caseId = "case_abcdefghijklmnopqrstu";
const otherCaseId = "case_zyxwvutsrqponmlkjihgf";
const guest = {
  kind: "guest" as const,
  guestId: "guest_abcdefghijklmnopqrs",
  guestSessionId: "guest_session_abcdefghijk",
};
const sameGuestDifferentSession = {
  ...guest,
  guestSessionId: "guest_session_zyxwvutsrq",
};
const otherGuest = {
  kind: "guest" as const,
  guestId: "guest_zyxwvutsrqponmlkji",
  guestSessionId: "guest_session_other_abcde",
};
const user = {
  kind: "user" as const,
  userId: "user_abcdefghijklmnopqrst",
  sessionId: "user_session_abcdefghijk",
};
const sameUserNewSession = {
  ...user,
  sessionId: "user_session_zyxwvutsrq",
};
const otherUser = {
  kind: "user" as const,
  userId: "user_zyxwvutsrqponmlkjih",
  sessionId: "user_session_other_abcdef",
};
const initialState: CaseState = { title: "完全虛構套房", phase: "listing" };

function createRepository(filesystem: JsonStateFilesystemPort = new MemoryJsonStateFilesystem()) {
  return new JsonCaseStateRepository(filesystem, CaseStateSchema);
}

describe("JsonCaseStateRepository ownership", () => {
  it("creates and loads a guest case only for the same guest session", async () => {
    const repository = createRepository();
    await expect(repository.create(guest, caseId, initialState)).resolves.toEqual({
      status: "created",
      revision: 0,
    });
    await expect(repository.load(guest, caseId)).resolves.toEqual({
      caseId,
      revision: 0,
      state: initialState,
    });
    await expect(repository.load(sameGuestDifferentSession, caseId)).resolves.toBeNull();
    await expect(repository.load(otherGuest, caseId)).resolves.toBeNull();
    await expect(repository.load(user, caseId)).resolves.toBeNull();
  });

  it("allows the same user across sessions but isolates other users and guests", async () => {
    const repository = createRepository();
    await repository.create(user, caseId, initialState);

    await expect(repository.load(sameUserNewSession, caseId)).resolves.toMatchObject({
      caseId,
      revision: 0,
    });
    await expect(repository.load(otherUser, caseId)).resolves.toBeNull();
    await expect(repository.load(guest, caseId)).resolves.toBeNull();
  });

  it("does not let an opaque case ID replace actor authorization on save", async () => {
    const repository = createRepository();
    await repository.create(user, caseId, initialState);

    await expect(
      repository.saveAtomic(otherUser, caseId, 0, { ...initialState, phase: "contract" }),
    ).resolves.toEqual({ status: "not_found_or_forbidden" });
    await expect(repository.load(user, caseId)).resolves.toMatchObject({
      revision: 0,
      state: initialState,
    });
  });
});

describe("JsonCaseStateRepository optimistic concurrency", () => {
  it("increments revision with compare-and-swap", async () => {
    const repository = createRepository();
    await repository.create(user, caseId, initialState);

    await expect(
      repository.saveAtomic(user, caseId, 0, { ...initialState, phase: "contract" }),
    ).resolves.toEqual({ status: "saved", revision: 1 });
    await expect(repository.load(user, caseId)).resolves.toEqual({
      caseId,
      revision: 1,
      state: { ...initialState, phase: "contract" },
    });
  });

  it("rejects a stale expected revision without writing", async () => {
    const repository = createRepository();
    await repository.create(user, caseId, initialState);

    await expect(
      repository.saveAtomic(user, caseId, 1, { ...initialState, phase: "report_ready" }),
    ).resolves.toEqual({ status: "revision_conflict" });
    await expect(repository.load(user, caseId)).resolves.toMatchObject({ revision: 0 });
  });

  it("maps an atomic filesystem race to revision conflict", async () => {
    const filesystem = new RejectNextCasFilesystem();
    const repository = createRepository(filesystem);
    await repository.create(user, caseId, initialState);
    filesystem.rejectNextWrite = true;

    await expect(
      repository.saveAtomic(user, caseId, 0, { ...initialState, phase: "contract" }),
    ).resolves.toEqual({ status: "revision_conflict" });
  });

  it("returns not-found-or-forbidden for an absent case", async () => {
    await expect(createRepository().saveAtomic(user, caseId, 0, initialState)).resolves.toEqual({
      status: "not_found_or_forbidden",
    });
  });

  it("does not overwrite an existing opaque case ID", async () => {
    const repository = createRepository();
    await repository.create(user, caseId, initialState);
    await expect(repository.create(otherUser, caseId, initialState)).resolves.toEqual({
      status: "case_id_unavailable",
    });
  });
});

describe("JsonCaseStateRepository validation", () => {
  it.each([
    ["malformed JSON", "{"],
    [
      "wrong state schema",
      JSON.stringify({
        schemaVersion: "rentproof.case-state-envelope.v1",
        caseId,
        owner: { kind: "user", userId: user.userId },
        revision: 0,
        state: { title: "demo", phase: "unknown" },
      }),
    ],
    [
      "unknown envelope field",
      JSON.stringify({
        schemaVersion: "rentproof.case-state-envelope.v1",
        caseId,
        owner: { kind: "user", userId: user.userId },
        revision: 0,
        state: initialState,
        rawPath: "C:\\private\\state.json",
      }),
    ],
  ])("fails closed for %s", async (_label, raw) => {
    const filesystem = new MemoryJsonStateFilesystem();
    filesystem.seedRaw(`cases/${caseId}.json`, raw);
    const repository = createRepository(filesystem);

    await expect(repository.load(user, caseId)).rejects.toMatchObject({
      code: "JSON_STATE_SCHEMA_INVALID",
    });
  });

  it("fails closed for invalid actors, IDs, states, and revisions", async () => {
    const repository = createRepository();
    await expect(repository.load({ kind: "user" } as never, caseId)).rejects.toMatchObject({
      code: "JSON_STATE_INPUT_INVALID",
    });
    await expect(repository.load(user, "guessable-id")).rejects.toMatchObject({
      code: "JSON_STATE_INPUT_INVALID",
    });
    await expect(
      repository.create(user, caseId, { title: "demo", phase: "invalid" } as never),
    ).rejects.toMatchObject({ code: "JSON_STATE_INPUT_INVALID" });
    await expect(repository.saveAtomic(user, caseId, -1, initialState)).rejects.toMatchObject({
      code: "JSON_STATE_INPUT_INVALID",
    });
  });

  it("uses a typed error without leaking stored content", () => {
    const error = new JsonCaseStateRepositoryError("JSON_STATE_SCHEMA_INVALID");
    expect(error.name).toBe("JsonCaseStateRepositoryError");
    expect(error.message).toBe("JSON_STATE_SCHEMA_INVALID");
  });

  it("refuses a stored envelope whose case ID does not match its storage key", async () => {
    const filesystem = new MemoryJsonStateFilesystem();
    filesystem.seedRaw(
      `cases/${caseId}.json`,
      JSON.stringify({
        schemaVersion: "rentproof.case-state-envelope.v1",
        caseId: otherCaseId,
        owner: { kind: "user", userId: user.userId },
        revision: 0,
        state: initialState,
      }),
    );
    await expect(createRepository(filesystem).load(user, caseId)).resolves.toBeNull();
  });
});

describe("MemoryJsonStateFilesystem", () => {
  it("provides atomic expected-text writes and test-only raw seeding", async () => {
    const filesystem = new MemoryJsonStateFilesystem();
    await expect(filesystem.writeTextIfUnchanged("key", null, "one")).resolves.toBe(true);
    await expect(filesystem.writeTextIfUnchanged("key", null, "two")).resolves.toBe(false);
    await expect(filesystem.writeTextIfUnchanged("key", "wrong", "two")).resolves.toBe(false);
    await expect(filesystem.writeTextIfUnchanged("key", "one", "two")).resolves.toBe(true);
    expect(filesystem.readRaw("key")).toBe("two");
    expect(filesystem.readRaw("missing")).toBeNull();
    filesystem.seedRaw("key", "seeded");
    await expect(filesystem.readText("key")).resolves.toBe("seeded");
  });
});

class RejectNextCasFilesystem implements JsonStateFilesystemPort {
  readonly #inner = new MemoryJsonStateFilesystem();
  rejectNextWrite = false;

  async readText(storageKey: string): Promise<string | null> {
    return this.#inner.readText(storageKey);
  }

  async writeTextIfUnchanged(
    storageKey: string,
    expectedText: string | null,
    nextText: string,
  ): Promise<boolean> {
    if (this.rejectNextWrite) {
      this.rejectNextWrite = false;
      return false;
    }
    return this.#inner.writeTextIfUnchanged(storageKey, expectedText, nextText);
  }
}
