import "server-only";
import { createHash } from "node:crypto";
import {
  ApplyWallFollowUpUseCase,
  FollowUpCaseStateSchema,
  InMemoryFollowUpCaseRepository,
  type FollowUpResultView,
} from "@/application/follow-ups";
import { PublicLiveAnalysisSnapshotSchema } from "@/server/analysis/live/contracts";
import { PublicFixtureAnalysisSnapshotSchema } from "@/server/demo/fixture-analysis";
import { getSyntheticUploadService } from "@/server/uploads/runtime";

const ACTOR_REF = "actor_fixture_followup_00001";
const repository = new InMemoryFollowUpCaseRepository();
const useCase = new ApplyWallFollowUpUseCase(repository);
const completed = new Map<string, { bindingHash: string; view: FollowUpResultView }>();
let running = false;

export function registerFollowUpBaseSnapshot(untrustedSnapshot: unknown): void {
  const fixture = PublicFixtureAnalysisSnapshotSchema.safeParse(untrustedSnapshot);
  const parsed = fixture.success
    ? fixture.data
    : PublicLiveAnalysisSnapshotSchema.parse(untrustedSnapshot);
  repository.register(
    FollowUpCaseStateSchema.parse({
      schemaVersion: "rentproof.follow-up-case-state.v1",
      caseId: parsed.caseVersion,
      ownerRef: ACTOR_REF,
      baseSnapshotId: parsed.snapshotId,
      manifestHash: parsed.manifestHash,
      executionMode: parsed.executionMode,
      claimFindings: parsed.findings,
      wallObservation: {
        observationId: "observation_wall_discoloration_01",
        description: "牆面可見不明變色；僅記錄可觀察現象。",
        locator: {
          type: "image",
          locatorId: "locator_wall_before_00001",
          artifactId: "viewing-view-10-jpg",
          bbox: [0.42, 0.18, 0.78, 0.72],
        },
      },
      wallFinding: {
        findingId: "finding_wall_follow_up_00001",
        status: "additional_evidence_needed",
        reasonCode: "WALL_DETAIL_IMAGE_REQUIRED",
        sourceLocatorIds: ["locator_wall_before_00001"],
        actions: ["補拍牆面近照、天花板與相鄰表面。", "向出租人詢問並索取可定位的修繕紀錄。"],
      },
    }),
  );
}

export type ApplySealedFollowUpResult =
  | { ok: true; status: 201 | 200; view: FollowUpResultView }
  | {
      ok: false;
      status: 404 | 409 | 422 | 503;
      code:
        | "FOLLOW_UP_RECEIPT_NOT_FOUND"
        | "FOLLOW_UP_RECEIPT_INVALID"
        | "FOLLOW_UP_CASE_NOT_FOUND_OR_FORBIDDEN"
        | "FOLLOW_UP_REVISION_CHANGED"
        | "FOLLOW_UP_ALREADY_APPLIED"
        | "FOLLOW_UP_REPOSITORY_FAILED"
        | "FOLLOW_UP_RUN_IN_PROGRESS"
        | "IDEMPOTENCY_KEY_CONFLICT";
    };

export async function applySealedWallFollowUp(input: {
  caseId: "golden-v1";
  findingId: "finding_wall_follow_up_00001";
  receiptId: string;
  expectedRevision: number;
  idempotencyKey: string;
}): Promise<ApplySealedFollowUpResult> {
  const bindingHash = sha256(
    JSON.stringify({
      actorRef: ACTOR_REF,
      caseId: input.caseId,
      findingId: input.findingId,
      receiptId: input.receiptId,
      expectedRevision: input.expectedRevision,
    }),
  );
  const prior = completed.get(input.idempotencyKey);
  if (prior !== undefined) {
    return prior.bindingHash === bindingHash
      ? { ok: true, status: 200, view: structuredClone(prior.view) }
      : { ok: false, status: 409, code: "IDEMPOTENCY_KEY_CONFLICT" };
  }
  if (running) return { ok: false, status: 409, code: "FOLLOW_UP_RUN_IN_PROGRESS" };
  running = true;
  try {
    const record = getSyntheticUploadService().receiptStore.getPrivate(input.receiptId);
    if (record === null) return { ok: false, status: 404, code: "FOLLOW_UP_RECEIPT_NOT_FOUND" };
    if (
      record.caseId !== input.caseId ||
      record.receipt.kind !== "follow_up" ||
      record.privatePayload.type !== "image" ||
      record.receipt.media.type !== "image" ||
      record.artifactId !== "follow-up-wall-close-up-png"
    ) {
      return { ok: false, status: 422, code: "FOLLOW_UP_RECEIPT_INVALID" };
    }
    const result = await useCase.execute({
      actorRef: ACTOR_REF,
      caseId: input.caseId,
      expectedRevision: input.expectedRevision,
      receipt: {
        receiptId: record.receipt.receiptId,
        kind: record.receipt.kind,
        artifactId: record.artifactId,
        media: {
          type: record.receipt.media.type,
          width: record.receipt.media.width,
          height: record.receipt.media.height,
        },
      },
      locator: {
        type: "image",
        locatorId: `locator_followup_${record.receipt.derivativeSha256?.slice(0, 20) ?? "unavailable_0000000000"}`,
        artifactId: record.artifactId,
        bbox: [0, 0, 1, 1],
      },
    });
    if (!result.ok) return mapUseCaseFailure(result.code);
    completed.set(input.idempotencyKey, { bindingHash, view: structuredClone(result.view) });
    return { ok: true, status: 201, view: result.view };
  } finally {
    running = false;
  }
}

function mapUseCaseFailure(
  code:
    | "FOLLOW_UP_CASE_NOT_FOUND_OR_FORBIDDEN"
    | "FOLLOW_UP_REVISION_CHANGED"
    | "FOLLOW_UP_ALREADY_APPLIED"
    | "FOLLOW_UP_REPOSITORY_FAILED",
): ApplySealedFollowUpResult {
  if (code === "FOLLOW_UP_CASE_NOT_FOUND_OR_FORBIDDEN") return { ok: false, status: 404, code };
  if (code === "FOLLOW_UP_REPOSITORY_FAILED") return { ok: false, status: 503, code };
  return { ok: false, status: 409, code };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
