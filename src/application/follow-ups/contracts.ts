import { z } from "zod";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
const ArtifactIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)+$/u);

export const FollowUpLocatorSchema = z
  .object({
    type: z.literal("image"),
    locatorId: OpaqueIdSchema,
    artifactId: ArtifactIdSchema,
    bbox: z.tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.bbox[0] >= value.bbox[2] || value.bbox[1] >= value.bbox[3]) {
      context.addIssue({ code: "custom", message: "FOLLOW_UP_LOCATOR_RANGE_INVALID" });
    }
  });

const ClaimFindingProjectionSchema = z
  .object({
    claimId: z.string().min(1).max(128),
    status: z.enum(["supported", "contradicted", "insufficient_evidence"]),
    sourceRefs: z.array(z.string().min(1).max(160)).min(1).max(8),
  })
  .strict();

export const FollowUpCaseStateSchema = z
  .object({
    schemaVersion: z.literal("rentproof.follow-up-case-state.v1"),
    caseId: z.literal("golden-v1"),
    ownerRef: OpaqueIdSchema,
    baseSnapshotId: OpaqueIdSchema,
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    executionMode: z.enum(["fixture", "live"]),
    claimFindings: z.array(ClaimFindingProjectionSchema).max(100),
    wallObservation: z
      .object({
        observationId: z.literal("observation_wall_discoloration_01"),
        description: z.literal("牆面可見不明變色；僅記錄可觀察現象。"),
        locator: FollowUpLocatorSchema,
      })
      .strict(),
    wallFinding: z
      .object({
        findingId: z.literal("finding_wall_follow_up_00001"),
        status: z.enum(["additional_evidence_needed", "evidence_acquired"]),
        reasonCode: z.enum(["WALL_DETAIL_IMAGE_REQUIRED", "WALL_DETAIL_IMAGE_ACQUIRED"]),
        sourceLocatorIds: z.array(OpaqueIdSchema).min(1).max(2),
        actions: z
          .array(
            z.enum(["補拍牆面近照、天花板與相鄰表面。", "向出租人詢問並索取可定位的修繕紀錄。"]),
          )
          .min(1)
          .max(2),
      })
      .strict(),
  })
  .strict();

export const ApplyFollowUpCommandSchema = z
  .object({
    actorRef: OpaqueIdSchema,
    caseId: z.literal("golden-v1"),
    expectedRevision: z.number().int().nonnegative(),
    receipt: z
      .object({
        receiptId: OpaqueIdSchema,
        kind: z.literal("follow_up"),
        artifactId: ArtifactIdSchema,
        media: z
          .object({
            type: z.literal("image"),
            width: z.number().int().positive().max(3_200),
            height: z.number().int().positive().max(3_200),
          })
          .strict(),
      })
      .strict(),
    locator: FollowUpLocatorSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.receipt.artifactId !== value.locator.artifactId) {
      context.addIssue({ code: "custom", message: "FOLLOW_UP_RECEIPT_LOCATOR_MISMATCH" });
    }
  });

export const FollowUpResultViewSchema = z
  .object({
    schemaVersion: z.literal("rentproof.follow-up-result.v1"),
    snapshotId: OpaqueIdSchema,
    caseRevision: z.number().int().positive(),
    executionMode: z.enum(["fixture", "live"]),
    changedDependencyIds: z.tuple([
      z.literal("observation_wall_discoloration_01"),
      z.literal("finding_wall_follow_up_00001"),
    ]),
    unchangedFindings: z.array(ClaimFindingProjectionSchema).max(100),
    wallObservation: FollowUpCaseStateSchema.shape.wallObservation,
    wallFinding: FollowUpCaseStateSchema.shape.wallFinding,
    sources: z.tuple([
      z
        .object({
          relation: z.literal("before"),
          label: z.literal("補拍前現場證據"),
          artifactId: ArtifactIdSchema,
          href: z.string().startsWith("/api/demo/golden-v1/artifacts/"),
        })
        .strict(),
      z
        .object({
          relation: z.literal("after"),
          label: z.literal("補拍後近照證據"),
          artifactId: ArtifactIdSchema,
          href: z.string().startsWith("/api/demo/golden-v1/artifacts/"),
        })
        .strict(),
    ]),
  })
  .strict();

export type FollowUpCaseState = z.infer<typeof FollowUpCaseStateSchema>;
export type ApplyFollowUpCommand = z.infer<typeof ApplyFollowUpCommandSchema>;
export type FollowUpResultView = z.infer<typeof FollowUpResultViewSchema>;
