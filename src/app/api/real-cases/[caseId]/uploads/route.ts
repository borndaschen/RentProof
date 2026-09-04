import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { extractTextPdf, pdfJsEngine } from "@/adapters/documents/pdfjs";
import { createApprovedWindowsFfmpegAdapters } from "@/adapters/ingestion/ffmpeg";
import { SharpImageSanitizer } from "@/adapters/ingestion/sharp";
import { packVerifiedVideoFrames, prepareVideoEvidence } from "@/application/video";
import { RealArtifactKindSchema } from "@/application/real-demo";
import { detectSensitiveConversationContent } from "@/application/conversation/security";
import { guardSingleUploadRequest } from "@/application/uploads";
import { resolveCurrentCaseActor } from "@/server/auth/current-actor";
import { validateSelfHostedAuthBinaryMutation } from "@/server/auth/request-guard";
import { getServerEnvironment } from "@/server/env";
import { privateNoStoreHeaders } from "@/server/http/private-response";
import { getRealDemoRuntime } from "@/server/real-demo";

export const runtime = "nodejs";

const HeaderSchema = z
  .object({
    filename: z.string().min(1).max(255),
    mime: z.enum(["image/jpeg", "image/png", "application/pdf", "video/mp4"]),
    kind: RealArtifactKindSchema,
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.kind === "contract_pdf") !== (value.mime === "application/pdf") ||
      (value.kind === "viewing_video") !== (value.mime === "video/mp4")
    ) {
      context.addIssue({ code: "custom", message: "UPLOAD_KIND_MIME_MISMATCH" });
    }
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "lan_secure_demo" ||
    !validateSelfHostedAuthBinaryMutation(request, environment)
  ) {
    return errorResponse(404, "REAL_DEMO_ROUTE_UNAVAILABLE");
  }
  const headers = HeaderSchema.safeParse({
    filename: request.headers.get("x-rentproof-upload-filename"),
    mime: request.headers.get("x-rentproof-upload-mime"),
    kind: request.headers.get("x-rentproof-upload-kind"),
    idempotencyKey: request.headers.get("idempotency-key"),
  });
  if (!headers.success) return errorResponse(400, "UPLOAD_REQUEST_INVALID");
  const verified = await guardSingleUploadRequest(
    {
      files: [
        {
          metadata: {
            filename: headers.data.filename.normalize("NFC"),
            declaredMime: headers.data.mime,
            kind: headers.data.kind,
          },
          stream: requestBody(request.body),
        },
      ],
    },
    { currentCaseOriginalImageBytes: 0 },
  );
  if (!verified.ok) return errorResponse(400, verified.code);

  try {
    const actor = await resolveCurrentCaseActor(request);
    const { caseId } = await context.params;
    const service = (await getRealDemoRuntime()).service;
    let saved;
    if (verified.upload.actualMime === "application/pdf") {
      const extracted = await extractTextPdf({ bytes: verified.upload.bytes, engine: pdfJsEngine });
      const serialized = JSON.stringify(extracted);
      if (detectSensitiveConversationContent(serialized).decision === "hard_block") {
        return errorResponse(422, "UPLOAD_AUTH_SECRET_DETECTED");
      }
      saved = await service.saveArtifact({
        actor,
        caseId,
        kind: "contract_pdf",
        mime: "application/pdf",
        originalSha256: verified.upload.sha256,
        originalBytes: verified.upload.bytes,
        extractedText: serialized,
      });
    } else if (verified.upload.actualMime === "video/mp4") {
      const localAppData = process.env["LOCALAPPDATA"];
      const configuredRoot = process.env["RENTPROOF_RUNTIME_DIR"]?.trim();
      if (!localAppData && !configuredRoot) return errorResponse(503, "VIDEO_RUNTIME_UNAVAILABLE");
      const runtimeRoot = configuredRoot || resolve(localAppData ?? "", "RentProof", "runtime");
      const prepared = await prepareVideoEvidence(
        {
          artifactId: `video_pending_${randomBytes(16).toString("hex")}`,
          declaredMime: "video/mp4",
          byteLength: verified.upload.byteLength,
        },
        verified.upload.bytes,
        createApprovedWindowsFfmpegAdapters({ runtimeRoot }),
      );
      if (!prepared.ok) return errorResponse(422, prepared.code);
      let bundle: Uint8Array;
      try {
        bundle = packVerifiedVideoFrames(prepared.frames);
      } catch {
        return errorResponse(422, "VIDEO_FRAME_BUNDLE_INVALID");
      }
      saved = await service.saveArtifact({
        actor,
        caseId,
        kind: "viewing_video",
        mime: "video/mp4",
        originalSha256: verified.upload.sha256,
        originalBytes: verified.upload.bytes,
        derivative: {
          bytes: bundle,
          sha256: createHash("sha256").update(bundle).digest("hex"),
        },
      });
    } else {
      const sanitized = await new SharpImageSanitizer().sanitize(
        verified.upload.bytes,
        verified.upload.actualMime,
      );
      if (!sanitized.ok) return errorResponse(422, "UPLOAD_IMAGE_PROCESSING_FAILED");
      saved = await service.saveArtifact({
        actor,
        caseId,
        kind: headers.data.kind,
        mime: verified.upload.actualMime,
        originalSha256: verified.upload.sha256,
        originalBytes: verified.upload.bytes,
        derivative: {
          bytes: sanitized.derivative.bytes,
          sha256: sanitized.derivative.sha256,
        },
      });
    }
    return Response.json(
      {
        schemaVersion: "rentproof.real-artifact-receipt.v1",
        artifactId: saved.artifactId,
        kind: headers.data.kind,
        mime: verified.upload.actualMime,
      },
      { status: 201, headers: privateNoStoreHeaders() },
    );
  } catch (error) {
    return mapError(error);
  }
}

function mapError(error: unknown): Response {
  const code = error instanceof Error ? error.message : "";
  if (code === "REAL_DEMO_AUTH_REQUIRED") return errorResponse(401, code);
  if (code === "REAL_DEMO_CASE_NOT_FOUND_OR_FORBIDDEN") return errorResponse(404, code);
  if (code === "REAL_DEMO_DUPLICATE_ARTIFACT") return errorResponse(409, code);
  if (code === "REAL_DEMO_CASE_IMAGE_LIMIT_EXCEEDED") return errorResponse(413, code);
  if (code === "REAL_DEMO_REQUEST_INVALID") return errorResponse(400, code);
  return errorResponse(503, "REAL_DEMO_UNAVAILABLE");
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: privateNoStoreHeaders() });
}

async function* requestBody(body: ReadableStream<Uint8Array> | null): AsyncIterable<unknown> {
  if (!body) return;
  const reader = body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}
