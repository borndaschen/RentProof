import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/application/repositories";
import { CaseHistoryService, HistoryAccessError, type CaseHistoryRepository } from ".";

const userA = {
  kind: "user",
  userId: "user_internal_a_00000001",
  sessionId: "session_self_hosted_a_00001",
} satisfies ActorContext;
const userB = {
  kind: "user",
  userId: "user_internal_b_00000001",
  sessionId: "session_self_hosted_b_00001",
} satisfies ActorContext;

function repository(): CaseHistoryRepository {
  return {
    async listOwned(actor) {
      return actor.kind === "user" && actor.userId === userA.userId
        ? [
            {
              caseId: "case_owned_by_a_00000001",
              displayName: "虛構套房 A",
              status: "ready",
              updatedAt: "2026-09-03T08:00:00.000Z",
            },
          ]
        : [];
    },
    async findOwned(actor, caseId) {
      if (
        actor.kind !== "user" ||
        actor.userId !== userA.userId ||
        caseId !== "case_owned_by_a_00000001"
      ) {
        return null;
      }
      return {
        caseId,
        displayName: "虛構套房 A",
        status: "ready",
        updatedAt: "2026-09-03T08:00:00.000Z",
        createdAt: "2026-09-03T07:00:00.000Z",
        revision: 2,
        sourceMode: "fixture",
      };
    },
  };
}

describe("CaseHistoryService", () => {
  it("lists only the authenticated account owner's cases", async () => {
    const service = new CaseHistoryService(repository());
    await expect(service.list(userA)).resolves.toHaveLength(1);
    await expect(service.list(userB)).resolves.toEqual([]);
  });

  it("returns the same not-found result for another user's opaque case id", async () => {
    const service = new CaseHistoryService(repository());
    await expect(service.detail(userB, "case_owned_by_a_00000001")).rejects.toMatchObject({
      code: "HISTORY_NOT_FOUND_OR_FORBIDDEN",
    });
  });

  it("denies unauthenticated and guest history access", async () => {
    const service = new CaseHistoryService(repository());
    await expect(service.list(null)).rejects.toEqual(
      new HistoryAccessError("HISTORY_AUTHENTICATION_REQUIRED"),
    );
    await expect(
      service.list({
        kind: "guest",
        guestId: "guest_demo_000000000001",
        guestSessionId: "guest_session_00000001",
      }),
    ).rejects.toMatchObject({ code: "HISTORY_ACCOUNT_REQUIRED" });
  });
});
