import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { InMemoryConversationRateLimiter } from "@/application/conversation/security";
import { guardSingleUploadRequest } from "@/application/uploads";
import type { DemoManifestFile } from "@/domain/demo";
import type {
  PrivateUploadRecord,
  SyntheticDemoManifestSource,
  SyntheticImageSanitizer,
  SyntheticPdfExtractor,
  SyntheticUploadProfile,
  SyntheticUploadErrorCode,
  SyntheticUploadResult,
  SyntheticUploadTransport,
  UploadReceipt,
} from "./contracts";
import { InMemoryPrivateUploadReceiptStore } from "./in-memory-private-receipt-store";
import { InMemorySyntheticUploadCoordinator } from "./request-coordinator";

const ALLOWED_KINDS = new Set<DemoManifestFile["kind"]>([
  "listing",
  "viewing",
  "contract",
  "follow_up",
]);
const CSRF_VALUE = "rentproof-synthetic-upload-v1";
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{20,128}$/u;
const ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export type SyntheticUploadServiceDependencies = {
  profile: SyntheticUploadProfile;
  manifestSource: SyntheticDemoManifestSource;
  imageSanitizer: SyntheticImageSanitizer;
  pdfExtractor: SyntheticPdfExtractor;
  receipts?: InMemoryPrivateUploadReceiptStore;
  coordinator?: InMemorySyntheticUploadCoordinator;
  rateLimiter?: InMemoryConversationRateLimiter;
};

export class SyntheticUploadService {
  readonly #profile: SyntheticUploadProfile;
  readonly #manifestSource: SyntheticDemoManifestSource;
  readonly #imageSanitizer: SyntheticImageSanitizer;
  readonly #pdfExtractor: SyntheticPdfExtractor;
  readonly #receipts: InMemoryPrivateUploadReceiptStore;
  readonly #coordinator: InMemorySyntheticUploadCoordinator;
  readonly #rateLimiter: InMemoryConversationRateLimiter;

  constructor(dependencies: SyntheticUploadServiceDependencies) {
    this.#profile = dependencies.profile;
    this.#manifestSource = dependencies.manifestSource;
    this.#imageSanitizer = dependencies.imageSanitizer;
    this.#pdfExtractor = dependencies.pdfExtractor;
    this.#receipts = dependencies.receipts ?? new InMemoryPrivateUploadReceiptStore();
    this.#coordinator = dependencies.coordinator ?? new InMemorySyntheticUploadCoordinator();
    this.#rateLimiter = dependencies.rateLimiter ?? new InMemoryConversationRateLimiter();
  }

  get receiptStore(): InMemoryPrivateUploadReceiptStore {
    return this.#receipts;
  }

  async handle(transport: SyntheticUploadTransport): Promise<SyntheticUploadResult> {
    const guarded = this.#guardTransport(transport);
    if (!guarded.ok) {
      return guarded.result;
    }
    const rate = this.#rateLimiter.consume({
      actorRef: "synthetic_upload_actor_0001",
      sourceIp: transport.sourceIp,
    });
    if (!rate.ok) {
      return {
        ok: false,
        status: 429,
        code: "UPLOAD_RATE_LIMITED",
        retryAfterSeconds: rate.retryAfterSeconds,
      };
    }
    const lease = this.#coordinator.acquire(transport.caseId, guarded.idempotencyKey);
    if (!lease.ok) {
      return {
        ok: false,
        status: lease.code === "UPLOAD_REPLAYED" ? 409 : 429,
        code: lease.code,
      };
    }

    let completed = false;
    try {
      const manifest = await this.#loadManifest();
      if (
        manifest.caseVersion !== "golden-v1" ||
        manifest.caseVersion !== this.#profile.caseVersion ||
        manifest.synthetic !== true
      ) {
        return failure(403, "DEV_SYNTHETIC_ARTIFACT_NOT_ALLOWLISTED");
      }
      const file = manifest.files.find((candidate) => candidate.id === guarded.artifactId);
      if (file === undefined || !isAllowlistedUploadFile(file)) {
        return failure(404, "DEV_SYNTHETIC_ARTIFACT_NOT_ALLOWLISTED");
      }
      if (this.#receipts.hasArtifact(file.id)) {
        return failure(409, "UPLOAD_REPLAYED");
      }
      if (
        guarded.filename !== basename(file.path) ||
        guarded.declaredMime !== file.mime ||
        (guarded.declaredMime === "application/pdf") !== (file.kind === "contract")
      ) {
        return failure(400, "DEMO_ARTIFACT_METADATA_MISMATCH");
      }

      const kind = toUploadKind(file);
      const guardedUpload = await guardSingleUploadRequest(
        {
          files: [
            {
              metadata: {
                filename: guarded.filename,
                declaredMime: guarded.declaredMime,
                kind,
                expectedSha256: file.sha256,
              },
              stream: transport.stream,
            },
          ],
        },
        { currentCaseOriginalImageBytes: this.#receipts.originalImageBytes("golden-v1") },
      );
      if (!guardedUpload.ok) {
        return failure(
          400,
          guardedUpload.code === "UPLOAD_SHA256_MISMATCH"
            ? "DEMO_ARTIFACT_TAMPERED"
            : guardedUpload.code,
        );
      }
      if (
        guardedUpload.upload.byteLength !== file.bytes ||
        guardedUpload.upload.sha256 !== file.sha256
      ) {
        return failure(400, "DEMO_ARTIFACT_TAMPERED");
      }

      const processed = await this.#process(file, guardedUpload.upload.bytes);
      if (!processed.ok) {
        return processed.result;
      }
      if (!this.#receipts.save(processed.record)) {
        return failure(409, "UPLOAD_REPLAYED");
      }
      this.#coordinator.complete(transport.caseId, guarded.idempotencyKey);
      completed = true;
      return { ok: true, status: 201, receipt: processed.record.receipt };
    } catch (error) {
      return error instanceof SyntheticUploadKnownError
        ? failure(503, error.code)
        : failure(503, "DEMO_ARTIFACT_UNAVAILABLE");
    } finally {
      if (!completed) {
        this.#coordinator.release(transport.caseId);
      }
    }
  }

  #guardTransport(transport: SyntheticUploadTransport):
    | {
        ok: true;
        artifactId: string;
        filename: string;
        declaredMime: "image/jpeg" | "image/png" | "application/pdf";
        idempotencyKey: string;
      }
    | { ok: false; result: SyntheticUploadResult } {
    if (this.#profile.allowRealData !== false) {
      return { ok: false, result: failure(503, "UPLOAD_REAL_DATA_FORBIDDEN") };
    }
    // Both explicit modes accept only the same sealed synthetic allowlist. Live
    // changes the analysis provider, never the upload trust boundary.
    if (transport.caseId !== "golden-v1" || this.#profile.caseVersion !== "golden-v1") {
      return { ok: false, result: failure(404, "UPLOAD_CASE_NOT_ALLOWED") };
    }
    if (!validSourceIp(transport.sourceIp)) {
      return { ok: false, result: failure(403, "UPLOAD_TRANSPORT_INVALID") };
    }
    const host = transport.headers.get("host");
    const origin = transport.headers.get("origin");
    if (host === null || !this.#profile.allowedHosts.includes(host)) {
      return { ok: false, result: failure(403, "REQUEST_HOST_FORBIDDEN") };
    }
    if (origin === null || !this.#profile.allowedOrigins.includes(origin)) {
      return { ok: false, result: failure(403, "REQUEST_ORIGIN_FORBIDDEN") };
    }
    const forwardedHost = transport.headers.get("x-forwarded-host");
    const forwardedProto = transport.headers.get("x-forwarded-proto");
    if (
      transport.headers.has("forwarded") ||
      (forwardedHost !== null && forwardedHost !== host) ||
      (forwardedProto !== null && forwardedProto !== new URL(origin).protocol.slice(0, -1))
    ) {
      return { ok: false, result: failure(403, "FORWARDED_HEADER_FORBIDDEN") };
    }
    if (transport.headers.get("x-rentproof-csrf") !== CSRF_VALUE) {
      return { ok: false, result: failure(403, "UPLOAD_CSRF_REQUIRED") };
    }
    if (transport.headers.get("content-type") !== "application/octet-stream") {
      return { ok: false, result: failure(415, "UPLOAD_TRANSPORT_INVALID") };
    }

    const artifactId = transport.headers.get("x-rentproof-demo-artifact-id");
    const filename = transport.headers.get("x-rentproof-upload-filename");
    const declaredMime = transport.headers.get("x-rentproof-upload-mime");
    const idempotencyKey = transport.headers.get("idempotency-key");
    if (
      artifactId === null ||
      !ARTIFACT_ID_PATTERN.test(artifactId) ||
      filename === null ||
      declaredMime === null ||
      !["image/jpeg", "image/png", "application/pdf"].includes(declaredMime) ||
      idempotencyKey === null ||
      !IDEMPOTENCY_PATTERN.test(idempotencyKey)
    ) {
      return { ok: false, result: failure(400, "UPLOAD_TRANSPORT_INVALID") };
    }
    return {
      ok: true,
      artifactId,
      filename,
      declaredMime:
        declaredMime === "image/jpeg"
          ? "image/jpeg"
          : declaredMime === "image/png"
            ? "image/png"
            : "application/pdf",
      idempotencyKey,
    };
  }

  async #loadManifest() {
    try {
      return await this.#manifestSource.load();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "DEMO_DIR_MISSING") {
        throw new SyntheticUploadKnownError("DEMO_DIR_MISSING");
      }
      throw new SyntheticUploadKnownError("DEMO_ARTIFACT_UNAVAILABLE");
    }
  }

  async #process(
    file: AllowlistedUploadFile,
    bytes: Uint8Array,
  ): Promise<
    { ok: true; record: PrivateUploadRecord } | { ok: false; result: SyntheticUploadResult }
  > {
    const receiptId = randomBytes(32).toString("base64url");
    if (file.mime === "application/pdf") {
      try {
        const extracted = await this.#pdfExtractor.extract(bytes);
        const receipt: UploadReceipt = {
          schemaVersion: "rentproof.synthetic-upload-receipt.v1",
          receiptId,
          kind: "contract",
          originalSha256: file.sha256,
          derivativeSha256: null,
          media: {
            type: "pdf",
            mime: "application/pdf",
            pageCount: extracted.pageCount,
            characterCount: extracted.characterCount,
          },
        };
        return {
          ok: true,
          record: {
            receipt,
            artifactId: file.id,
            caseId: "golden-v1",
            originalByteLength: bytes.byteLength,
            privatePayload: { type: "pdf", extracted },
          },
        };
      } catch {
        return { ok: false, result: failure(422, "UPLOAD_PDF_PROCESSING_FAILED") };
      }
    }

    const image = await this.#imageSanitizer.sanitize(bytes, file.mime);
    if (!image.ok) {
      return { ok: false, result: failure(422, "UPLOAD_IMAGE_PROCESSING_FAILED") };
    }
    const receipt: UploadReceipt = {
      schemaVersion: "rentproof.synthetic-upload-receipt.v1",
      receiptId,
      kind: file.kind === "listing" ? "listing" : file.kind === "viewing" ? "viewing" : "follow_up",
      originalSha256: file.sha256,
      derivativeSha256: image.derivative.sha256,
      media: {
        type: "image",
        mime: file.mime,
        width: image.derivative.width,
        height: image.derivative.height,
      },
    };
    return {
      ok: true,
      record: {
        receipt,
        artifactId: file.id,
        caseId: "golden-v1",
        originalByteLength: bytes.byteLength,
        privatePayload: {
          type: "image",
          derivativeBytes: Uint8Array.from(image.derivative.bytes),
        },
      },
    };
  }
}

class SyntheticUploadKnownError extends Error {
  readonly code: "DEMO_DIR_MISSING" | "DEMO_ARTIFACT_UNAVAILABLE";

  constructor(code: "DEMO_DIR_MISSING" | "DEMO_ARTIFACT_UNAVAILABLE") {
    super(code);
    this.code = code;
  }
}

function failure(status: number, code: SyntheticUploadErrorCode): SyntheticUploadResult {
  return { ok: false, status, code };
}

function validSourceIp(sourceIp: string): boolean {
  return sourceIp === "127.0.0.1";
}

type AllowlistedUploadFile = DemoManifestFile & {
  kind: "listing" | "viewing" | "contract" | "follow_up";
  mime: "image/jpeg" | "image/png" | "application/pdf";
};

function isAllowlistedUploadFile(file: DemoManifestFile): file is AllowlistedUploadFile {
  return (
    ALLOWED_KINDS.has(file.kind) &&
    (file.mime === "image/jpeg" || file.mime === "image/png" || file.mime === "application/pdf")
  );
}

function toUploadKind(file: AllowlistedUploadFile) {
  return file.kind === "contract"
    ? ("contract_pdf" as const)
    : file.kind === "listing"
      ? ("listing_image" as const)
      : file.kind === "viewing"
        ? ("viewing_image" as const)
        : ("follow_up_image" as const);
}
