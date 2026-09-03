import { createHash } from "node:crypto";
import {
  ApplyFollowUpCommandSchema,
  FollowUpCaseStateSchema,
  FollowUpResultViewSchema,
  type FollowUpCaseState,
  type FollowUpResultView,
} from "./contracts";

export type FollowUpSaveResult = "saved" | "revision_conflict" | "failed";

export interface FollowUpCaseRepository {
  load(caseId: "golden-v1"): Promise<{ revision: number; state: FollowUpCaseState } | null>;
  saveAtomic(
    caseId: "golden-v1",
    expectedRevision: number,
    state: FollowUpCaseState,
  ): Promise<FollowUpSaveResult>;
}

export type ApplyFollowUpResult =
  | Readonly<{ ok: true; view: FollowUpResultView }>
  | Readonly<{
      ok: false;
      code:
        | "FOLLOW_UP_CASE_NOT_FOUND_OR_FORBIDDEN"
        | "FOLLOW_UP_REVISION_CHANGED"
        | "FOLLOW_UP_ALREADY_APPLIED"
        | "FOLLOW_UP_REPOSITORY_FAILED";
    }>;

export class ApplyWallFollowUpUseCase {
  constructor(private readonly repository: FollowUpCaseRepository) {}

  async execute(untrustedCommand: unknown): Promise<ApplyFollowUpResult> {
    const command = ApplyFollowUpCommandSchema.parse(untrustedCommand);
    const current = await this.repository.load(command.caseId);
    if (current === null || current.state.ownerRef !== command.actorRef) {
      return { ok: false, code: "FOLLOW_UP_CASE_NOT_FOUND_OR_FORBIDDEN" };
    }
    if (current.revision !== command.expectedRevision) {
      return { ok: false, code: "FOLLOW_UP_REVISION_CHANGED" };
    }
    if (current.state.wallFinding.status === "evidence_acquired") {
      return { ok: false, code: "FOLLOW_UP_ALREADY_APPLIED" };
    }

    const preserved = structuredClone(current.state.claimFindings);
    const beforeArtifactId = current.state.wallObservation.locator.artifactId;
    const beforeLocatorId = current.state.wallObservation.locator.locatorId;
    const next = FollowUpCaseStateSchema.parse({
      ...current.state,
      claimFindings: preserved,
      wallObservation: {
        ...current.state.wallObservation,
        locator: command.locator,
      },
      wallFinding: {
        ...current.state.wallFinding,
        status: "evidence_acquired",
        reasonCode: "WALL_DETAIL_IMAGE_ACQUIRED",
        sourceLocatorIds: [beforeLocatorId, command.locator.locatorId],
        actions: ["向出租人詢問並索取可定位的修繕紀錄。"],
      },
    });
    if (JSON.stringify(next.claimFindings) !== JSON.stringify(preserved)) {
      return { ok: false, code: "FOLLOW_UP_REPOSITORY_FAILED" };
    }
    const saved = await this.repository.saveAtomic(command.caseId, current.revision, next);
    if (saved === "revision_conflict") return { ok: false, code: "FOLLOW_UP_REVISION_CHANGED" };
    if (saved === "failed") return { ok: false, code: "FOLLOW_UP_REPOSITORY_FAILED" };

    const revision = current.revision + 1;
    return {
      ok: true,
      view: FollowUpResultViewSchema.parse({
        schemaVersion: "rentproof.follow-up-result.v1",
        snapshotId: `snapshot_followup_${sha256(`${next.baseSnapshotId}:${revision}:${command.receipt.receiptId}`).slice(0, 24)}`,
        caseRevision: revision,
        executionMode: next.executionMode,
        changedDependencyIds: ["observation_wall_discoloration_01", "finding_wall_follow_up_00001"],
        unchangedFindings: next.claimFindings,
        wallObservation: next.wallObservation,
        wallFinding: next.wallFinding,
        sources: [
          {
            relation: "before",
            label: "補拍前現場證據",
            artifactId: beforeArtifactId,
            href: sourceHref(beforeArtifactId),
          },
          {
            relation: "after",
            label: "補拍後近照證據",
            artifactId: command.receipt.artifactId,
            href: sourceHref(command.receipt.artifactId),
          },
        ],
      }),
    };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sourceHref(artifactId: string): string {
  return `/api/demo/golden-v1/artifacts/${encodeURIComponent(artifactId)}`;
}

export class InMemoryFollowUpCaseRepository implements FollowUpCaseRepository {
  #current: { revision: number; state: FollowUpCaseState } | null = null;

  register(state: FollowUpCaseState): void {
    const parsed = FollowUpCaseStateSchema.parse(state);
    if (this.#current?.state.baseSnapshotId === parsed.baseSnapshotId) return;
    this.#current = { revision: 0, state: structuredClone(parsed) };
  }

  load(caseId: "golden-v1"): Promise<{ revision: number; state: FollowUpCaseState } | null> {
    if (this.#current === null || this.#current.state.caseId !== caseId)
      return Promise.resolve(null);
    return Promise.resolve(structuredClone(this.#current));
  }

  saveAtomic(
    caseId: "golden-v1",
    expectedRevision: number,
    state: FollowUpCaseState,
  ): Promise<FollowUpSaveResult> {
    if (this.#current === null || this.#current.state.caseId !== caseId)
      return Promise.resolve("failed");
    if (this.#current.revision !== expectedRevision) return Promise.resolve("revision_conflict");
    this.#current = {
      revision: expectedRevision + 1,
      state: structuredClone(FollowUpCaseStateSchema.parse(state)),
    };
    return Promise.resolve("saved");
  }
}
