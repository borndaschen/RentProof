import { describe, expect, it } from "vitest";
import { ServerOwnedFocusRefResolver } from "./focus-ref-resolver";
import { InMemoryFocusRefSource } from "./in-memory-focus-source";

const actorRef = "actor_abcdefghijklmnopqrst";
const otherActorRef = "actor_zyxwvutsrqponmlkjihg";
const caseId = "case_abcdefghijklmnopqrstu";
const otherCaseId = "case_zyxwvutsrqponmlkjihgf";
const snapshotId = "snapshot_abcdefghijklmnop";
const otherSnapshotId = "snapshot_zyxwvutsrqponmlk";
const focusRefId = "focus_abcdefghijklmnopqrs";
const sourceRefId = "source_abcdefghijklmnopqr";

function record(overrides: Record<string, unknown> = {}) {
  return {
    focusRefId,
    actorRef,
    caseId,
    snapshotId,
    kind: "finding",
    label: "電費條款差異",
    verifiedSummary: "廣告與契約記載的每度電費不同。",
    sourceRefIds: [sourceRefId],
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    actorRef,
    caseId,
    snapshotId,
    candidateFocusRefId: focusRefId,
    referenceRequirement: "required",
    allowedKinds: ["finding"],
    ...overrides,
  };
}

describe("ServerOwnedFocusRefResolver", () => {
  it("resolves only the minimum server-owned projection", async () => {
    const resolver = new ServerOwnedFocusRefResolver(new InMemoryFocusRefSource([record()]));
    const result = await resolver.resolve(input());

    expect(result).toEqual({
      ok: true,
      focusRefs: [
        {
          focusRefId,
          kind: "finding",
          snapshotId,
          label: "電費條款差異",
          verifiedSummary: "廣告與契約記載的每度電費不同。",
          sourceRefIds: [sourceRefId],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(actorRef);
    expect(JSON.stringify(result)).not.toContain(caseId);
  });

  it("treats the browser ID as a candidate and rejects browser-supplied projection fields", async () => {
    const resolver = new ServerOwnedFocusRefResolver(new InMemoryFocusRefSource([record()]));
    expect(
      await resolver.resolve(input({ label: "browser label", verifiedSummary: "browser summary" })),
    ).toEqual({ ok: false, code: "CONVERSATION_FOCUS_FORBIDDEN" });
  });

  it("requires a focus for ambiguous omitted references", async () => {
    const resolver = new ServerOwnedFocusRefResolver(new InMemoryFocusRefSource([record()]));
    expect(await resolver.resolve(input({ candidateFocusRefId: null }))).toEqual({
      ok: false,
      code: "CONVERSATION_FOCUS_REQUIRED",
    });
    expect(
      await resolver.resolve(
        input({ candidateFocusRefId: null, referenceRequirement: "optional" }),
      ),
    ).toEqual({ ok: true, focusRefs: [] });
  });

  it("separates unknown and malformed focus IDs from authorization failures", async () => {
    const resolver = new ServerOwnedFocusRefResolver(new InMemoryFocusRefSource([record()]));
    expect(await resolver.resolve(input({ candidateFocusRefId: "not-an-opaque-id" }))).toEqual({
      ok: false,
      code: "CONVERSATION_FOCUS_NOT_FOUND",
    });
    expect(
      await resolver.resolve({
        ...input(),
        candidateFocusRefId: "focus_unknown_abcdefghijkl",
      }),
    ).toEqual({ ok: false, code: "CONVERSATION_FOCUS_NOT_FOUND" });
  });

  it.each([
    ["actor", { actorRef: otherActorRef }],
    ["case", { caseId: otherCaseId }],
  ] as const)("rejects cross-%s references as forbidden", async (_label, change) => {
    const resolver = new ServerOwnedFocusRefResolver(new InMemoryFocusRefSource([record()]));
    expect(await resolver.resolve(input(change))).toEqual({
      ok: false,
      code: "CONVERSATION_FOCUS_FORBIDDEN",
    });
  });

  it("distinguishes stale snapshots", async () => {
    const resolver = new ServerOwnedFocusRefResolver(new InMemoryFocusRefSource([record()]));
    expect(await resolver.resolve(input({ snapshotId: otherSnapshotId }))).toEqual({
      ok: false,
      code: "CONVERSATION_FOCUS_STALE",
    });
    expect(await resolver.resolve(input({ snapshotId: null }))).toEqual({
      ok: false,
      code: "CONVERSATION_FOCUS_STALE",
    });
  });

  it("rejects a type outside the server allowlist", async () => {
    const resolver = new ServerOwnedFocusRefResolver(new InMemoryFocusRefSource([record()]));
    expect(await resolver.resolve(input({ allowedKinds: ["claim"] }))).toEqual({
      ok: false,
      code: "CONVERSATION_FOCUS_FORBIDDEN",
    });
  });

  it.each([
    ["email", { verifiedSummary: "請看 tenant@example.com 的資料" }],
    ["phone", { label: "聯絡 0912-345-678" }],
    ["Windows path", { verifiedSummary: "來源在 C:\\Users\\Person\\contract.pdf" }],
    ["UNC path", { verifiedSummary: "來源在 \\\\server\\share\\contract.pdf" }],
    ["POSIX path", { verifiedSummary: "來源在 /home/person/contract.pdf" }],
    ["file URL", { verifiedSummary: "來源在 file:///C:/secret.txt" }],
  ] as const)("does not project %s", async (_label, unsafeRecord) => {
    const resolver = new ServerOwnedFocusRefResolver(
      new InMemoryFocusRefSource([record(unsafeRecord)]),
    );
    expect(await resolver.resolve(input())).toEqual({
      ok: false,
      code: "CONVERSATION_FOCUS_FORBIDDEN",
    });
  });
});

describe("InMemoryFocusRefSource", () => {
  it("validates strict server records and rejects duplicate IDs", () => {
    expect(
      () => new InMemoryFocusRefSource([{ ...record(), rawHistory: "do not expose" }]),
    ).toThrow();
    expect(() => new InMemoryFocusRefSource([record(), record()])).toThrow(
      "DUPLICATE_FOCUS_REF_ID",
    );
  });

  it("returns defensive copies", async () => {
    const source = new InMemoryFocusRefSource([record()]);
    const first = await source.findById(focusRefId);
    if (!first) {
      throw new Error("missing fixture");
    }
    first.sourceRefIds.push("source_mutated_abcdefghijk");
    expect((await source.findById(focusRefId))?.sourceRefIds).toEqual([sourceRefId]);
    expect(await source.findById("focus_unknown_abcdefghijkl")).toBeNull();
  });
});
