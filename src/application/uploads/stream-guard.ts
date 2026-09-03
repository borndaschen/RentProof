import { createHash } from "node:crypto";
import { z } from "zod";
import {
  UPLOAD_LIMITS,
  UploadFileMetadataSchema,
  UploadMimeTypeSchema,
  type UploadFailure,
  type UploadFileMetadata,
  type UploadMimeType,
} from "@/domain/uploads";

const UploadServerContextSchema = z
  .object({
    currentCaseOriginalImageBytes: z.number().int().nonnegative().safe(),
  })
  .strict();

export type VerifiedUpload = {
  metadata: UploadFileMetadata;
  actualMime: UploadMimeType;
  byteLength: number;
  sha256: string;
  bytes: Uint8Array;
};

export type GuardUploadResult = { ok: true; upload: VerifiedUpload } | UploadFailure;

export async function guardSingleUploadRequest(
  untrustedRequest: unknown,
  untrustedServerContext: unknown,
): Promise<GuardUploadResult> {
  const context = UploadServerContextSchema.safeParse(untrustedServerContext);
  if (!context.success) {
    return { ok: false, code: "UPLOAD_REQUEST_INVALID" };
  }
  if (!isPlainObject(untrustedRequest)) {
    return { ok: false, code: "UPLOAD_REQUEST_INVALID" };
  }
  const keys = Object.keys(untrustedRequest);
  if (keys.some((key) => key !== "files") || !Array.isArray(untrustedRequest["files"])) {
    return { ok: false, code: "UPLOAD_REQUEST_INVALID" };
  }
  const files = untrustedRequest["files"];
  if (files.length !== UPLOAD_LIMITS.filesPerRequest) {
    return { ok: false, code: "UPLOAD_MULTIPLE_FILES_NOT_ALLOWED" };
  }
  const file = files[0];
  if (!isPlainObject(file)) {
    return { ok: false, code: "UPLOAD_REQUEST_INVALID" };
  }
  const fileKeys = Object.keys(file);
  if (
    fileKeys.some((key) => key !== "metadata" && key !== "stream") ||
    !("metadata" in file) ||
    !("stream" in file)
  ) {
    return { ok: false, code: "UPLOAD_REQUEST_INVALID" };
  }

  const metadata = parseMetadata(file["metadata"]);
  if (!metadata.ok) {
    return metadata;
  }
  if (!isAsyncIterable(file["stream"])) {
    return { ok: false, code: "UPLOAD_STREAM_INVALID" };
  }

  const compatibility = validateKindMimeAndFilename(metadata.value);
  if (compatibility) {
    return compatibility;
  }
  const maxBytes =
    metadata.value.kind === "contract_pdf" ? UPLOAD_LIMITS.pdfBytes : UPLOAD_LIMITS.imageBytes;
  const streamed = await readBoundedStream(file["stream"], maxBytes);
  if (!streamed.ok) {
    return streamed;
  }

  const actualMime = detectMagicMime(streamed.bytes);
  if (actualMime === null) {
    return { ok: false, code: "UPLOAD_UNSUPPORTED_MEDIA" };
  }
  if (actualMime !== metadata.value.declaredMime) {
    return { ok: false, code: "UPLOAD_MIME_MISMATCH" };
  }
  if (
    actualMime !== "application/pdf" &&
    context.data.currentCaseOriginalImageBytes + streamed.byteLength >
      UPLOAD_LIMITS.caseOriginalImageBytes
  ) {
    return { ok: false, code: "UPLOAD_CASE_IMAGE_BYTES_EXCEEDED" };
  }
  if (
    metadata.value.expectedSha256 !== undefined &&
    metadata.value.expectedSha256 !== streamed.sha256
  ) {
    return { ok: false, code: "UPLOAD_SHA256_MISMATCH" };
  }
  return {
    ok: true,
    upload: {
      metadata: metadata.value,
      actualMime,
      byteLength: streamed.byteLength,
      sha256: streamed.sha256,
      bytes: streamed.bytes,
    },
  };
}

type ParsedMetadata = { ok: true; value: UploadFileMetadata } | UploadFailure;

function parseMetadata(untrustedMetadata: unknown): ParsedMetadata {
  if (
    isPlainObject(untrustedMetadata) &&
    typeof untrustedMetadata["declaredMime"] === "string" &&
    !UploadMimeTypeSchema.safeParse(untrustedMetadata["declaredMime"]).success
  ) {
    return { ok: false, code: "UPLOAD_UNSUPPORTED_MEDIA" };
  }
  const parsed = UploadFileMetadataSchema.safeParse(untrustedMetadata);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  if (
    parsed.error.issues.some(
      (issue) => issue.path[0] === "filename" && issue.message === "UPLOAD_FILENAME_INVALID",
    )
  ) {
    return { ok: false, code: "UPLOAD_FILENAME_INVALID" };
  }
  return { ok: false, code: "UPLOAD_REQUEST_INVALID" };
}

function validateKindMimeAndFilename(metadata: UploadFileMetadata): UploadFailure | null {
  const isPdf = metadata.kind === "contract_pdf";
  if (isPdf !== (metadata.declaredMime === "application/pdf")) {
    return { ok: false, code: "UPLOAD_MIME_MISMATCH" };
  }
  const filename = metadata.filename.toLowerCase();
  const extensionMatches =
    metadata.declaredMime === "application/pdf"
      ? filename.endsWith(".pdf")
      : metadata.declaredMime === "image/png"
        ? filename.endsWith(".png")
        : filename.endsWith(".jpg") || filename.endsWith(".jpeg");
  return extensionMatches ? null : { ok: false, code: "UPLOAD_FILENAME_INVALID" };
}

type StreamReadResult =
  { ok: true; bytes: Uint8Array; byteLength: number; sha256: string } | UploadFailure;

async function readBoundedStream(
  stream: AsyncIterable<unknown>,
  maxBytes: number,
): Promise<StreamReadResult> {
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let byteLength = 0;
  try {
    for await (const untrustedChunk of stream) {
      const chunk = toUint8Array(untrustedChunk);
      if (chunk === null) {
        return { ok: false, code: "UPLOAD_STREAM_INVALID" };
      }
      if (chunk.byteLength === 0) {
        continue;
      }
      byteLength += chunk.byteLength;
      if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) {
        return { ok: false, code: "UPLOAD_FILE_TOO_LARGE" };
      }
      const copy = Uint8Array.from(chunk);
      chunks.push(copy);
      hash.update(copy);
    }
  } catch {
    return { ok: false, code: "UPLOAD_STREAM_INVALID" };
  }
  if (byteLength === 0) {
    return { ok: false, code: "UPLOAD_FILE_EMPTY" };
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes, byteLength, sha256: hash.digest("hex") };
}

function detectMagicMime(bytes: Uint8Array): UploadMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return (
    bytes.byteLength >= prefix.length && prefix.every((value, index) => bytes[index] === value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (
    !ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) !== "[object Uint8Array]"
  ) {
    return null;
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
