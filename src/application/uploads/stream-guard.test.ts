import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UPLOAD_LIMITS } from "@/domain/uploads";
import { guardInlineAttachmentText } from "./inline-attachment-guard";
import { guardSingleUploadRequest } from "./stream-guard";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const PDF = new TextEncoder().encode("%PDF-1.7\nfixture");

function streamOf(...chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function request(overrides: Record<string, unknown> = {}, stream: unknown = streamOf(PNG)) {
  return {
    files: [
      {
        metadata: {
          filename: "listing.png",
          declaredMime: "image/png",
          kind: "listing_image",
          ...overrides,
        },
        stream,
      },
    ],
  };
}

const context = { currentCaseOriginalImageBytes: 0 };

describe("guardSingleUploadRequest", () => {
  it("accepts a PNG signature split across chunks and computes SHA-256", async () => {
    const result = await guardSingleUploadRequest(
      request({}, streamOf(PNG.slice(0, 3), PNG.slice(3))),
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      upload: {
        actualMime: "image/png",
        byteLength: PNG.byteLength,
        sha256: createHash("sha256").update(PNG).digest("hex"),
      },
    });
    if (result.ok) {
      expect(result.upload.bytes).toEqual(PNG);
    }
  });

  it("accepts JPEG and PDF magic with compatible kinds and extensions", async () => {
    await expect(
      guardSingleUploadRequest(
        request(
          { filename: "room.jpeg", declaredMime: "image/jpeg", kind: "viewing_image" },
          streamOf(JPEG),
        ),
        context,
      ),
    ).resolves.toMatchObject({ ok: true, upload: { actualMime: "image/jpeg" } });
    await expect(
      guardSingleUploadRequest(
        request(
          { filename: "contract.pdf", declaredMime: "application/pdf", kind: "contract_pdf" },
          streamOf(PDF),
        ),
        context,
      ),
    ).resolves.toMatchObject({ ok: true, upload: { actualMime: "application/pdf" } });
  });

  it("requires exactly one file", async () => {
    await expect(guardSingleUploadRequest({ files: [] }, context)).resolves.toEqual({
      ok: false,
      code: "UPLOAD_MULTIPLE_FILES_NOT_ALLOWED",
    });
    await expect(
      guardSingleUploadRequest({ files: request().files.concat(request().files) }, context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_MULTIPLE_FILES_NOT_ALLOWED" });
  });

  it("rejects client attempts to override limits or case totals", async () => {
    await expect(
      guardSingleUploadRequest(request({ maxBytes: Number.MAX_SAFE_INTEGER }), context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_REQUEST_INVALID" });
    await expect(
      guardSingleUploadRequest({ ...request(), currentCaseOriginalImageBytes: 0 }, context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_REQUEST_INVALID" });
  });

  it("stops immediately when a chunk crosses the fixed PDF byte limit", async () => {
    let readAfterOverflow = false;
    const stream: AsyncIterable<unknown> = {
      async *[Symbol.asyncIterator]() {
        yield PDF;
        yield new Uint8Array(UPLOAD_LIMITS.pdfBytes);
        readAfterOverflow = true;
        yield Uint8Array.of(1);
      },
    };
    const result = await guardSingleUploadRequest(
      request(
        { filename: "contract.pdf", declaredMime: "application/pdf", kind: "contract_pdf" },
        stream,
      ),
      context,
    );
    expect(result).toEqual({ ok: false, code: "UPLOAD_FILE_TOO_LARGE" });
    expect(readAfterOverflow).toBe(false);
  });

  it("rejects fake MIME and unknown magic", async () => {
    await expect(guardSingleUploadRequest(request({}, streamOf(JPEG)), context)).resolves.toEqual({
      ok: false,
      code: "UPLOAD_MIME_MISMATCH",
    });
    await expect(
      guardSingleUploadRequest(
        request({}, streamOf(new TextEncoder().encode("not an image"))),
        context,
      ),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_UNSUPPORTED_MEDIA" });
  });

  it.each([
    ["image/svg+xml", "graphic.svg", "<svg></svg>"],
    ["image/gif", "animation.gif", "GIF89a"],
  ])("rejects unsupported %s before accepting content", async (declaredMime, filename, body) => {
    await expect(
      guardSingleUploadRequest(
        request({ declaredMime, filename }, streamOf(new TextEncoder().encode(body))),
        context,
      ),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_UNSUPPORTED_MEDIA" });
  });

  it("rejects kind/MIME and filename/extension mismatches", async () => {
    await expect(
      guardSingleUploadRequest(request({ kind: "contract_pdf" }), context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_MIME_MISMATCH" });
    await expect(
      guardSingleUploadRequest(request({ filename: "listing.jpg" }), context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_FILENAME_INVALID" });
    await expect(
      guardSingleUploadRequest(request({ filename: "../listing.png" }), context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_FILENAME_INVALID" });
  });

  it("enforces the server-owned per-case original-image total", async () => {
    await expect(
      guardSingleUploadRequest(request(), {
        currentCaseOriginalImageBytes: UPLOAD_LIMITS.caseOriginalImageBytes - PNG.byteLength + 1,
      }),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_CASE_IMAGE_BYTES_EXCEEDED" });
  });

  it("verifies an optional expected SHA-256", async () => {
    const expectedSha256 = createHash("sha256").update(PNG).digest("hex");
    await expect(
      guardSingleUploadRequest(request({ expectedSha256 }), context),
    ).resolves.toMatchObject({ ok: true, upload: { sha256: expectedSha256 } });
    await expect(
      guardSingleUploadRequest(request({ expectedSha256: "0".repeat(64) }), context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_SHA256_MISMATCH" });
  });

  it("rejects empty, malformed, and failed streams", async () => {
    await expect(guardSingleUploadRequest(request({}, streamOf()), context)).resolves.toEqual({
      ok: false,
      code: "UPLOAD_FILE_EMPTY",
    });
    await expect(
      guardSingleUploadRequest(request({}, streamOf("not bytes")), context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_STREAM_INVALID" });
    const failed: AsyncIterable<unknown> = {
      async *[Symbol.asyncIterator]() {
        throw new Error("stream failure");
      },
    };
    await expect(guardSingleUploadRequest(request({}, failed), context)).resolves.toEqual({
      ok: false,
      code: "UPLOAD_STREAM_INVALID",
    });
    await expect(
      guardSingleUploadRequest(request({}, "not async iterable"), context),
    ).resolves.toEqual({ ok: false, code: "UPLOAD_STREAM_INVALID" });
  });

  it("rejects invalid request and server-context shapes", async () => {
    await expect(guardSingleUploadRequest(null, context)).resolves.toEqual({
      ok: false,
      code: "UPLOAD_REQUEST_INVALID",
    });
    await expect(
      guardSingleUploadRequest(request(), { currentCaseOriginalImageBytes: -1 }),
    ).resolves.toEqual({
      ok: false,
      code: "UPLOAD_REQUEST_INVALID",
    });
    await expect(guardSingleUploadRequest({ files: [null] }, context)).resolves.toEqual({
      ok: false,
      code: "UPLOAD_REQUEST_INVALID",
    });
  });
});

describe("guardInlineAttachmentText", () => {
  it("rejects data URLs and labeled base64 attachments", () => {
    expect(guardInlineAttachmentText("data:image/png;base64,AAAA")).toEqual({
      ok: false,
      code: "UPLOAD_INLINE_ATTACHMENT_DISALLOWED",
    });
    expect(guardInlineAttachmentText(`附件：${"A".repeat(40)}`)).toEqual({
      ok: false,
      code: "UPLOAD_INLINE_ATTACHMENT_DISALLOWED",
    });
  });

  it("does not reject ordinary text that only mentions base64", () => {
    expect(guardInlineAttachmentText("請不要把附件轉成 base64")).toEqual({ ok: true });
  });
});
