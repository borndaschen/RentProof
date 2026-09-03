import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DemoManifestFile } from "@/domain/demo";
import { UPLOAD_LIMITS } from "@/domain/uploads";
import type {
  SyntheticDemoManifestSource,
  SyntheticImageSanitizer,
  SyntheticPdfExtractor,
} from "./contracts";
import { InMemoryPrivateUploadReceiptStore } from "./in-memory-private-receipt-store";
import { SyntheticUploadService } from "./synthetic-upload-service";

const PNG_A = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PNG_B = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]);
const PDF = new TextEncoder().encode("%PDF-1.7\nfixture");

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function file(
  id: string,
  path: string,
  kind: DemoManifestFile["kind"],
  mime: string,
  bytes: Uint8Array,
): DemoManifestFile {
  return {
    id,
    path,
    kind,
    mime,
    bytes: bytes.byteLength,
    sha256: sha(bytes),
    provenance: { source: "synthetic test", license: "synthetic" },
  };
}

const listing = file("listing-a", "listing/listing-a.png", "listing", "image/png", PNG_A);
const viewing = file("viewing-b", "viewing/viewing-b.png", "viewing", "image/png", PNG_B);
const contract = file("contract-a", "contract/contract-a.pdf", "contract", "application/pdf", PDF);
const truth = file(
  "truth-a",
  "truth/assertions.json",
  "truth",
  "application/json",
  Uint8Array.of(1),
);
const interaction = file(
  "interaction-a",
  "interaction/chat.png",
  "interaction",
  "image/png",
  PNG_A,
);

function streamOf(...chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function headers(
  artifact: DemoManifestFile = listing,
  overrides: Record<string, string> = {},
): Headers {
  return new Headers({
    host: "192.168.1.20:3000",
    origin: "http://192.168.1.20:3000",
    "content-type": "application/octet-stream",
    "x-rentproof-csrf": "rentproof-synthetic-upload-v1",
    "x-rentproof-demo-artifact-id": artifact.id,
    "x-rentproof-upload-filename": artifact.path.split("/").at(-1) ?? "missing",
    "x-rentproof-upload-mime": artifact.mime,
    "idempotency-key": "upload_idempotency_000001",
    ...overrides,
  });
}

function transport(
  artifact: DemoManifestFile = listing,
  bytes: AsyncIterable<unknown> = streamOf(PNG_A),
  overrides: Record<string, unknown> = {},
) {
  return {
    caseId: "golden-v1",
    sourceIp: "192.168.1.44",
    headers: headers(artifact),
    stream: bytes,
    ...overrides,
  };
}

function service(
  overrides: {
    manifestSource?: SyntheticDemoManifestSource;
    imageSanitizer?: SyntheticImageSanitizer;
    pdfExtractor?: SyntheticPdfExtractor;
    llmMode?: "fixture" | "live";
    allowRealData?: boolean;
    receipts?: InMemoryPrivateUploadReceiptStore;
  } = {},
) {
  return new SyntheticUploadService({
    profile: {
      deploymentProfile: "lan_development",
      allowRealData: (overrides.allowRealData ?? false) as false,
      llmMode: overrides.llmMode ?? "fixture",
      caseVersion: "golden-v1",
      allowedHosts: ["192.168.1.20:3000"],
      allowedOrigins: ["http://192.168.1.20:3000"],
    },
    manifestSource:
      overrides.manifestSource ??
      ({
        load: async () => ({
          caseVersion: "golden-v1",
          synthetic: true,
          manifestHash: "a".repeat(64),
          files: [listing, viewing, contract, truth, interaction],
        }),
      } satisfies SyntheticDemoManifestSource),
    imageSanitizer:
      overrides.imageSanitizer ??
      ({
        sanitize: async (bytes) => ({
          ok: true,
          derivative: {
            bytes: Uint8Array.from(bytes),
            width: 640,
            height: 480,
            sha256: sha(bytes),
          },
        }),
      } satisfies SyntheticImageSanitizer),
    pdfExtractor:
      overrides.pdfExtractor ??
      ({
        extract: async () => ({
          pageCount: 1,
          characterCount: 4,
          pages: [{ page: 1, text: "秘密文字", segments: [] }],
        }),
      } satisfies SyntheticPdfExtractor),
    ...(overrides.receipts === undefined ? {} : { receipts: overrides.receipts }),
  });
}

describe("SyntheticUploadService success", () => {
  it("stores a sanitized image privately and returns only typed receipt metadata", async () => {
    const uploadService = service();
    const result = await uploadService.handle(transport());
    expect(result).toMatchObject({
      ok: true,
      status: 201,
      receipt: {
        kind: "listing",
        originalSha256: listing.sha256,
        media: { type: "image", mime: "image/png", width: 640, height: 480 },
      },
    });
    expect(JSON.stringify(result)).not.toContain(listing.id);
    expect(JSON.stringify(result)).not.toContain("listing/listing-a.png");
    expect(JSON.stringify(result)).not.toContain("秘密文字");
    if (result.ok) {
      expect(result.receipt.receiptId).toMatch(/^[A-Za-z0-9_-]{20,128}$/u);
      expect(uploadService.receiptStore.getPrivate(result.receipt.receiptId)).toMatchObject({
        privatePayload: { type: "image", derivativeBytes: PNG_A },
      });
    }
  });

  it("stores extracted PDF text privately but returns only counts", async () => {
    const uploadService = service();
    const result = await uploadService.handle(
      transport(contract, streamOf(PDF), { headers: headers(contract) }),
    );
    expect(result).toMatchObject({
      ok: true,
      receipt: {
        kind: "contract",
        derivativeSha256: null,
        media: { type: "pdf", pageCount: 1, characterCount: 4 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("秘密文字");
    if (result.ok) {
      expect(
        uploadService.receiptStore.getPrivate(result.receipt.receiptId)?.privatePayload,
      ).toMatchObject({ type: "pdf", extracted: { pages: [{ text: "秘密文字" }] } });
    }
  });
});

describe("SyntheticUploadService manifest and byte gates", () => {
  it("rejects fake MIME and unknown magic", async () => {
    await expect(service().handle(transport(listing, streamOf(JPEG)))).resolves.toMatchObject({
      ok: false,
      code: "UPLOAD_MIME_MISMATCH",
    });
  });

  it("rejects stream overflow before parser invocation", async () => {
    let parserCalled = false;
    const oversized = {
      ...listing,
      bytes: UPLOAD_LIMITS.imageBytes + 9,
      sha256: "0".repeat(64),
    };
    const imageSanitizer: SyntheticImageSanitizer = {
      sanitize: async () => {
        parserCalled = true;
        return { ok: false, code: "unexpected" };
      },
    };
    const uploadService = service({
      imageSanitizer,
      manifestSource: {
        load: async () => ({
          caseVersion: "golden-v1",
          synthetic: true,
          manifestHash: "a".repeat(64),
          files: [oversized],
        }),
      },
    });
    await expect(
      uploadService.handle(
        transport(oversized, streamOf(PNG_A, new Uint8Array(UPLOAD_LIMITS.imageBytes)), {
          headers: headers(oversized),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "UPLOAD_FILE_TOO_LARGE" });
    expect(parserCalled).toBe(false);
  });

  it("rejects tampered and cross-artifact bytes", async () => {
    const tampered = Uint8Array.from(PNG_A);
    tampered[tampered.length - 1] = 9;
    await expect(service().handle(transport(listing, streamOf(tampered)))).resolves.toMatchObject({
      ok: false,
      code: "DEMO_ARTIFACT_TAMPERED",
    });
    await expect(
      service().handle(transport(viewing, streamOf(PNG_A), { headers: headers(viewing) })),
    ).resolves.toMatchObject({ ok: false, code: "DEMO_ARTIFACT_TAMPERED" });
  });

  it("rejects base64/data URL bodies as unsupported media", async () => {
    await expect(
      service().handle(
        transport(listing, streamOf(new TextEncoder().encode("data:image/png;base64,AAAA"))),
      ),
    ).resolves.toMatchObject({ ok: false, code: "UPLOAD_UNSUPPORTED_MEDIA" });
  });

  it("enforces the server-owned case image quota", async () => {
    const receipts = new InMemoryPrivateUploadReceiptStore();
    receipts.save({
      receipt: {
        schemaVersion: "rentproof.synthetic-upload-receipt.v1",
        receiptId: "receipt_seeded_abcdefghijkl",
        kind: "viewing",
        originalSha256: "a".repeat(64),
        derivativeSha256: "b".repeat(64),
        media: { type: "image", mime: "image/png", width: 1, height: 1 },
      },
      artifactId: "seeded-artifact",
      caseId: "golden-v1",
      originalByteLength: UPLOAD_LIMITS.caseOriginalImageBytes,
      privatePayload: { type: "image", derivativeBytes: Uint8Array.of(1) },
    });
    await expect(service({ receipts }).handle(transport())).resolves.toMatchObject({
      ok: false,
      code: "UPLOAD_CASE_IMAGE_BYTES_EXCEEDED",
    });
  });

  it.each([truth, interaction])("rejects non-upload manifest kind $kind", async (artifact) => {
    const artifactHeaders =
      artifact.kind === "truth"
        ? headers(artifact, {
            "x-rentproof-upload-filename": "assertions.png",
            "x-rentproof-upload-mime": "image/png",
          })
        : headers(artifact);
    await expect(
      service().handle(transport(artifact, streamOf(PNG_A), { headers: artifactHeaders })),
    ).resolves.toMatchObject({
      ok: false,
      code: "DEV_SYNTHETIC_ARTIFACT_NOT_ALLOWLISTED",
    });
  });

  it("rejects filename and declared MIME that differ from manifest", async () => {
    await expect(
      service().handle(
        transport(listing, streamOf(PNG_A), {
          headers: headers(listing, { "x-rentproof-upload-filename": "other.png" }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "DEMO_ARTIFACT_METADATA_MISMATCH" });
  });

  it("maps missing and failed manifest loaders to typed errors", async () => {
    await expect(
      service({
        manifestSource: {
          load: async () => {
            throw new Error("DEMO_DIR_MISSING");
          },
        },
      }).handle(transport()),
    ).resolves.toMatchObject({ ok: false, code: "DEMO_DIR_MISSING" });
    await expect(
      service({
        manifestSource: {
          load: async () => {
            throw new Error("raw provider detail");
          },
        },
      }).handle(transport()),
    ).resolves.toMatchObject({ ok: false, code: "DEMO_ARTIFACT_UNAVAILABLE" });
  });

  it("rejects a non-synthetic or wrong-version manifest", async () => {
    for (const manifest of [
      { caseVersion: "golden-v1", synthetic: false },
      { caseVersion: "golden-v2", synthetic: true },
    ]) {
      await expect(
        service({
          manifestSource: {
            load: async () => ({
              ...manifest,
              manifestHash: "a".repeat(64),
              files: [listing],
            }),
          },
        }).handle(transport()),
      ).resolves.toMatchObject({
        ok: false,
        code: "DEV_SYNTHETIC_ARTIFACT_NOT_ALLOWLISTED",
      });
    }
  });
});

describe("SyntheticUploadService replay, parser, and transport gates", () => {
  it("rejects same-key and same-artifact replay", async () => {
    const sameKey = service();
    await expect(sameKey.handle(transport())).resolves.toMatchObject({ ok: true });
    await expect(sameKey.handle(transport())).resolves.toMatchObject({
      ok: false,
      code: "UPLOAD_REPLAYED",
    });

    const differentKey = service();
    await differentKey.handle(transport());
    await expect(
      differentKey.handle(
        transport(listing, streamOf(PNG_A), {
          headers: headers(listing, { "idempotency-key": "upload_idempotency_000002" }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "UPLOAD_REPLAYED" });
  });

  it("fails closed on image and PDF parser errors without storing receipt", async () => {
    const imageFailure = service({
      imageSanitizer: { sanitize: async () => ({ ok: false, code: "decode failed" }) },
    });
    await expect(imageFailure.handle(transport())).resolves.toMatchObject({
      ok: false,
      code: "UPLOAD_IMAGE_PROCESSING_FAILED",
    });

    const pdfFailure = service({
      pdfExtractor: {
        extract: async () => {
          throw new Error("secret parser error");
        },
      },
    });
    await expect(
      pdfFailure.handle(transport(contract, streamOf(PDF), { headers: headers(contract) })),
    ).resolves.toMatchObject({ ok: false, code: "UPLOAD_PDF_PROCESSING_FAILED" });
  });

  it("allows sealed synthetic uploads in Live but rejects wrong case, network, and request metadata", async () => {
    await expect(service({ llmMode: "live" }).handle(transport())).resolves.toMatchObject({
      ok: true,
      status: 201,
    });
    const changes = [
      { caseId: "other-case", expected: "UPLOAD_CASE_NOT_ALLOWED" },
      { sourceIp: "8.8.8.8", expected: "UPLOAD_TRANSPORT_INVALID" },
      { headers: headers(listing, { host: "evil.example" }), expected: "REQUEST_HOST_FORBIDDEN" },
      {
        headers: headers(listing, { origin: "http://evil.example" }),
        expected: "REQUEST_ORIGIN_FORBIDDEN",
      },
      {
        headers: headers(listing, { "x-rentproof-csrf": "wrong" }),
        expected: "UPLOAD_CSRF_REQUIRED",
      },
      {
        headers: headers(listing, { forwarded: "for=1.2.3.4" }),
        expected: "FORWARDED_HEADER_FORBIDDEN",
      },
      {
        headers: headers(listing, { "content-type": "text/plain" }),
        expected: "UPLOAD_TRANSPORT_INVALID",
      },
    ];
    for (const change of changes) {
      await expect(
        service().handle(transport(listing, streamOf(PNG_A), change)),
      ).resolves.toMatchObject({
        ok: false,
        code: change.expected,
      });
    }
  });

  it("rejects any profile that attempts to enable real data", async () => {
    await expect(service({ allowRealData: true }).handle(transport())).resolves.toMatchObject({
      ok: false,
      code: "UPLOAD_REAL_DATA_FORBIDDEN",
    });
  });

  it("rate-limits repeated failed attempts per source bucket", async () => {
    const uploadService = service({
      manifestSource: {
        load: async () => {
          throw new Error("missing");
        },
      },
    });
    for (let index = 0; index < 3; index += 1) {
      await uploadService.handle(
        transport(listing, streamOf(PNG_A), {
          headers: headers(listing, { "idempotency-key": `upload_idempotency_00000${index}` }),
        }),
      );
    }
    await expect(
      uploadService.handle(
        transport(listing, streamOf(PNG_A), {
          headers: headers(listing, { "idempotency-key": "upload_idempotency_000009" }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, status: 429, code: "UPLOAD_RATE_LIMITED" });
  });

  it("rejects concurrent processing for the same case", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const uploadService = service({
      imageSanitizer: {
        sanitize: async (bytes) => {
          await waiting;
          return {
            ok: true,
            derivative: { bytes, width: 1, height: 1, sha256: sha(bytes) },
          };
        },
      },
    });
    const first = uploadService.handle(transport());
    await Promise.resolve();
    await expect(
      uploadService.handle(
        transport(viewing, streamOf(PNG_B), {
          headers: headers(viewing, { "idempotency-key": "upload_idempotency_000002" }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "UPLOAD_CONCURRENT_REQUEST" });
    release?.();
    await expect(first).resolves.toMatchObject({ ok: true });
  });
});
