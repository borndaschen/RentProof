import { z } from "zod";
import { OpaqueIdSchema } from "@/domain/conversation";

export const REAL_DEMO_CLOUD_CONSENT_VERSION = "rentproof.cloud-processing-demo.v1";
export const REAL_DEMO_CLOUD_CONSENT_TEXT =
  "我同意為了整理與比對本案件，將必要內容傳送至OpenAI處理；我可以隨時刪除案件。";

export const RealCaseDisplayNameSchema = z.string().trim().min(1).max(120);
export const RealArtifactKindSchema = z.enum([
  "listing_image",
  "viewing_image",
  "contract_pdf",
  "follow_up_image",
]);
export const RealArtifactMimeSchema = z.enum(["image/jpeg", "image/png", "application/pdf"]);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const SafeRelativeStoragePathSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_.-]{0,499}$/u)
  .refine((value) => !value.split("/").includes(".."));

export const RealArtifactReservationSchema = z
  .object({
    artifactId: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    kind: RealArtifactKindSchema,
    mime: RealArtifactMimeSchema,
    originalSha256: Sha256Schema,
    originalBytes: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
  })
  .strict()
  .superRefine((value, context) => {
    const isContract = value.kind === "contract_pdf";
    if (isContract !== (value.mime === "application/pdf")) {
      context.addIssue({ code: "custom", message: "ARTIFACT_KIND_MIME_MISMATCH" });
    }
    if (isContract && value.originalBytes > 15 * 1024 * 1024) {
      context.addIssue({ code: "custom", message: "CONTRACT_BYTES_EXCEEDED" });
    }
  });

export const StoredArtifactPathsSchema = z
  .object({
    originalRelativePath: SafeRelativeStoragePathSchema,
    derivativeRelativePath: SafeRelativeStoragePathSchema.nullable(),
    extractedTextRelativePath: SafeRelativeStoragePathSchema.nullable(),
    derivativeSha256: Sha256Schema.nullable(),
    derivativeBytes: z.number().int().positive().nullable(),
  })
  .strict();

export type RealArtifactKind = z.infer<typeof RealArtifactKindSchema>;
export type RealArtifactMime = z.infer<typeof RealArtifactMimeSchema>;
export type RealArtifactReservation = z.infer<typeof RealArtifactReservationSchema>;
export type StoredArtifactPaths = z.infer<typeof StoredArtifactPathsSchema>;

export type AvailableRealArtifact = Readonly<{
  artifactId: string;
  caseId: string;
  kind: RealArtifactKind;
  mime: RealArtifactMime;
  derivativeRelativePath: string | null;
  extractedTextRelativePath: string | null;
}>;

export type RealArtifactAnalysisPayload = Readonly<{
  artifactId: string;
  kind: RealArtifactKind | "listing_text";
  mime: RealArtifactMime | "text/plain";
  bytes: Uint8Array;
}>;

export const RealAnalysisSnapshotSchema = z
  .object({
    schemaVersion: z.literal("rentproof.real-analysis-snapshot.v1"),
    snapshotId: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    artifactSetHash: Sha256Schema,
    findings: z
      .array(
        z
          .object({
            claimId: OpaqueIdSchema,
            key: z.string().min(1).max(80),
            status: z.enum(["supported", "contradicted", "insufficient_evidence"]),
            sourceRefs: z.array(OpaqueIdSchema).min(1).max(8),
          })
          .strict(),
      )
      .max(100),
    stages: z
      .array(
        z
          .object({
            stage: z.enum(["listing.extract", "evidence.extract", "contract.extract"]),
            model: z.string().min(1).max(128),
            promptVersion: z.string().min(1).max(64),
            requestedServiceTier: z.literal("default"),
            usageKnown: z.boolean(),
          })
          .strict(),
      )
      .length(3),
    ruleSummary: z
      .object({
        profile: z.literal("p1"),
        checked: z.literal(10),
        possibleDifference: z.number().int().nonnegative().max(10),
        missingInformation: z.number().int().nonnegative().max(10),
      })
      .strict(),
    nextActions: z.array(z.string().min(1).max(240)).min(1).max(10),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type RealAnalysisSnapshot = z.infer<typeof RealAnalysisSnapshotSchema>;

export class RealDemoAccessError extends Error {
  override readonly name = "RealDemoAccessError";
  constructor(
    readonly code:
      | "REAL_DEMO_AUTH_REQUIRED"
      | "REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN"
      | "REAL_DEMO_DUPLICATE_ARTIFACT"
      | "REAL_DEMO_CASE_IMAGE_LIMIT_EXCEEDED"
      | "REAL_DEMO_STORAGE_FAILED"
      | "REAL_DEMO_ARTIFACT_SET_INCOMPLETE"
      | "REAL_DEMO_TRANSFER_ALREADY_COMPLETED"
      | "REAL_DEMO_CASE_REVISION_STALE"
      | "REAL_DEMO_REQUEST_INVALID",
  ) {
    super(code);
  }
}
