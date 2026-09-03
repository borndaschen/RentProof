import { describe, expect, it } from "vitest";
import { ApplyWallFollowUpUseCase, InMemoryFollowUpCaseRepository } from "./service";
import { FollowUpCaseStateSchema } from "./contracts";

const OWNER = "actor_fixture_followup_00001";

function state() {
  return FollowUpCaseStateSchema.parse({
    schemaVersion: "rentproof.follow-up-case-state.v1",
    caseId: "golden-v1",
    ownerRef: OWNER,
    baseSnapshotId: "snapshot_fixture_abcdefghij",
    manifestHash: "a".repeat(64),
    executionMode: "fixture",
    claimFindings: [
      {
        claimId: "claim-washing-machine",
        status: "insufficient_evidence",
        sourceRefs: ["viewing:view-10"],
      },
      {
        claimId: "claim-electricity-rate",
        status: "contradicted",
        sourceRefs: ["contract:page-2"],
      },
    ],
    wallObservation: {
      observationId: "observation_wall_discoloration_01",
      description: "牆面可見不明變色；僅記錄可觀察現象。",
      locator: {
        type: "image",
        locatorId: "locator_wall_before_00001",
        artifactId: "viewing-view-10-jpg",
        bbox: [0.4, 0.2, 0.8, 0.7],
      },
    },
    wallFinding: {
      findingId: "finding_wall_follow_up_00001",
      status: "additional_evidence_needed",
      reasonCode: "WALL_DETAIL_IMAGE_REQUIRED",
      sourceLocatorIds: ["locator_wall_before_00001"],
      actions: ["補拍牆面近照、天花板與相鄰表面。", "向出租人詢問並索取可定位的修繕紀錄。"],
    },
  });
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    actorRef: OWNER,
    caseId: "golden-v1",
    expectedRevision: 0,
    receipt: {
      receiptId: "receipt_followup_abcdefghij",
      kind: "follow_up",
      artifactId: "follow-up-wall-close-up-png",
      media: { type: "image", width: 640, height: 480 },
    },
    locator: {
      type: "image",
      locatorId: "locator_followup_abcdefghij",
      artifactId: "follow-up-wall-close-up-png",
      bbox: [0, 0, 1, 1],
    },
    ...overrides,
  };
}

describe("ApplyWallFollowUpUseCase", () => {
  it("recomputes only the wall dependency and preserves every claim finding ID and status", async () => {
    const repository = new InMemoryFollowUpCaseRepository();
    repository.register(state());
    const before = await repository.load("golden-v1");
    const result = await new ApplyWallFollowUpUseCase(repository).execute(command());
    expect(result.ok).toBe(true);
    if (!result.ok || before === null) return;
    expect(result.view.changedDependencyIds).toEqual([
      "observation_wall_discoloration_01",
      "finding_wall_follow_up_00001",
    ]);
    expect(result.view.unchangedFindings).toEqual(before.state.claimFindings);
    expect(result.view.wallFinding).toMatchObject({
      findingId: "finding_wall_follow_up_00001",
      status: "evidence_acquired",
      reasonCode: "WALL_DETAIL_IMAGE_ACQUIRED",
    });
    expect(result.view.caseRevision).toBe(1);
    expect(result.view.sources.map((source) => source.relation)).toEqual(["before", "after"]);
  });

  it("describes only observable discoloration and never infers leakage, structure, or liability", async () => {
    const repository = new InMemoryFollowUpCaseRepository();
    repository.register(state());
    const result = await new ApplyWallFollowUpUseCase(repository).execute(command());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.view);
    expect(result.view.wallObservation.description).toBe("牆面可見不明變色；僅記錄可觀察現象。");
    expect(result.view.wallFinding.actions).toContain("向出租人詢問並索取可定位的修繕紀錄。");
    expect(serialized).not.toMatch(/漏水|結構危險|責任歸屬|房東有責/u);
  });

  it("fails closed for a different owner, stale revision, and repeat application", async () => {
    const repository = new InMemoryFollowUpCaseRepository();
    repository.register(state());
    const useCase = new ApplyWallFollowUpUseCase(repository);
    await expect(
      useCase.execute(command({ actorRef: "actor_different_followup_0001" })),
    ).resolves.toEqual({ ok: false, code: "FOLLOW_UP_CASE_NOT_FOUND_OR_FORBIDDEN" });
    await expect(useCase.execute(command({ expectedRevision: 2 }))).resolves.toEqual({
      ok: false,
      code: "FOLLOW_UP_REVISION_CHANGED",
    });
    await expect(useCase.execute(command())).resolves.toMatchObject({ ok: true });
    await expect(useCase.execute(command({ expectedRevision: 1 }))).resolves.toEqual({
      ok: false,
      code: "FOLLOW_UP_ALREADY_APPLIED",
    });
  });

  it("rejects client-shaped receipt and locator mismatch before mutation", async () => {
    const repository = new InMemoryFollowUpCaseRepository();
    repository.register(state());
    const useCase = new ApplyWallFollowUpUseCase(repository);
    await expect(
      useCase.execute(
        command({
          locator: {
            type: "image",
            locatorId: "locator_followup_abcdefghij",
            artifactId: "viewing-view-10-jpg",
            bbox: [0, 0, 1, 1],
          },
        }),
      ),
    ).rejects.toThrow();
    expect((await repository.load("golden-v1"))?.revision).toBe(0);
  });
});
