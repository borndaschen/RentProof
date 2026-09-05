import { describe, expect, it } from "vitest";
import { ProcessingRecordSchema, processingActorRef } from "./contracts";

const caseId = "case_000000000000000001";
const artifactId = "artifact_000000000000001";
const base = {
  actor: {
    kind: "guest",
    guestId: "guest_00000000000000001",
    guestSessionId: "guest_session_000000001",
  },
  reservation: {
    caseId,
    artifactId,
    kind: "contract_pdf",
    mime: "application/pdf",
    originalSha256: "a".repeat(64),
    originalBytes: 100,
  },
  idempotencyHash: "b".repeat(64),
  expectedRevision: 0,
  policyHash: "c".repeat(64),
  type: "contract.ocr",
  state: "queued",
  stored: {
    originalRelativePath: `${caseId}/${artifactId}/original.enc`,
    derivativeRelativePath: null,
    extractedTextRelativePath: null,
    derivativeSha256: null,
    derivativeBytes: null,
  },
  confirmation: null,
  reasonCode: null,
  jobId: null,
};
describe("processing record bindings", () => {
  it("uses the exact guest session as the job actor", () => {
    const record = ProcessingRecordSchema.parse(base);
    expect(processingActorRef(record.actor)).toBe("guest_session_000000001");
  });
  it.each(["originalRelativePath", "derivativeRelativePath", "extractedTextRelativePath"])(
    "rejects a %s from another case even if it is a safe relative path",
    (field) => {
      expect(
        ProcessingRecordSchema.safeParse({
          ...base,
          stored: { ...base.stored, [field]: "case_other/artifact_other/original.enc" },
        }).success,
      ).toBe(false);
    },
  );
  it("rejects a job type that does not match its reserved media kind", () => {
    expect(
      ProcessingRecordSchema.safeParse({ ...base, type: "evidence.video_frames" }).success,
    ).toBe(false);
  });
});
