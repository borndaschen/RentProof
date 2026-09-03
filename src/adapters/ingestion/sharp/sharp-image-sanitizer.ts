import { createHash } from "node:crypto";
import sharp, { type Metadata, type Sharp } from "sharp";
import { UPLOAD_LIMITS } from "@/domain/uploads";
import type { SharpImageSanitizerErrorCode, SharpImageSanitizerFailure } from "./errors";

const DERIVATIVE_MAX_LONG_EDGE = 3_200;
const DEFAULT_TIMEOUT_MS = 10_000;

export type SanitizedImage = {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  format: "jpeg" | "png";
  width: number;
  height: number;
  colorSpace: "srgb";
  sha256: string;
  metadataStripped: true;
};

export type SharpImageSanitizerResult =
  { ok: true; derivative: SanitizedImage } | SharpImageSanitizerFailure;

export interface SharpOperationTimeoutPort {
  run<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T>;
}

export class SharpSanitizerTimeoutError extends Error {
  override readonly name = "SharpSanitizerTimeoutError";
}

export type SharpImageSanitizerOptions = {
  timeoutMs?: number;
  timeoutPort?: SharpOperationTimeoutPort;
};

export type DecodedImageMetadata = {
  format?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  pages?: number | undefined;
};

export type DerivativeImageMetadata = DecodedImageMetadata & {
  space?: string | undefined;
  orientation?: number | undefined;
  exif?: Uint8Array | undefined;
  iptc?: Uint8Array | undefined;
  xmp?: Uint8Array | undefined;
  tifftagPhotoshop?: Uint8Array | undefined;
};

export class SharpImageSanitizer {
  readonly #timeoutMs: number;
  readonly #timeoutPort: SharpOperationTimeoutPort;

  constructor(options: SharpImageSanitizerOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#timeoutPort = options.timeoutPort ?? new DefaultSharpOperationTimeoutPort();
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new RangeError("timeoutMs must be positive");
    }
  }

  async sanitize(
    untrustedInput: unknown,
    untrustedDeclaredMime: unknown,
  ): Promise<SharpImageSanitizerResult> {
    const input = toUint8Array(untrustedInput);
    if (input === null || input.byteLength === 0) {
      return { ok: false, code: "IMAGE_SANITIZER_INPUT_INVALID" };
    }
    if (input.byteLength > UPLOAD_LIMITS.imageBytes) {
      return { ok: false, code: "IMAGE_SANITIZER_FILE_TOO_LARGE" };
    }
    if (untrustedDeclaredMime !== "image/jpeg" && untrustedDeclaredMime !== "image/png") {
      return { ok: false, code: "IMAGE_SANITIZER_UNSUPPORTED_MEDIA" };
    }

    const magicFormat = detectImageMagic(input);
    if (magicFormat === null) {
      return { ok: false, code: "IMAGE_SANITIZER_UNSUPPORTED_MEDIA" };
    }
    const expectedFormat = untrustedDeclaredMime === "image/jpeg" ? "jpeg" : "png";
    if (magicFormat !== expectedFormat) {
      return { ok: false, code: "IMAGE_SANITIZER_MIME_MISMATCH" };
    }

    const inputBuffer = Buffer.from(input);
    const metadataResult = await this.#readMetadata(inputBuffer);
    if (!metadataResult.ok) {
      return metadataResult;
    }
    const decodedValidation = validateDecodedImageMetadata(metadataResult.metadata, expectedFormat);
    if (!decodedValidation.ok) {
      return decodedValidation;
    }

    const pipeline = createPipeline(inputBuffer, this.#timeoutMs);
    pipeline.autoOrient().toColourspace("srgb").resize({
      width: DERIVATIVE_MAX_LONG_EDGE,
      height: DERIVATIVE_MAX_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
    if (expectedFormat === "jpeg") {
      pipeline.jpeg({ quality: 85, progressive: true, chromaSubsampling: "4:2:0" });
    } else {
      pipeline.png({ compressionLevel: 9, progressive: false, palette: false });
    }

    let output: Buffer;
    try {
      output = await this.#runAndDestroy(pipeline, pipeline.toBuffer());
    } catch (error) {
      return { ok: false, code: mapSharpError(error) };
    }

    const verified = await verifySharpDerivative(
      output,
      untrustedDeclaredMime,
      this.#timeoutMs,
      this.#timeoutPort,
    );
    if (!verified.ok) {
      return verified;
    }
    return {
      ok: true,
      derivative: {
        bytes: Uint8Array.from(output),
        mime: untrustedDeclaredMime,
        format: expectedFormat,
        width: verified.width,
        height: verified.height,
        colorSpace: "srgb",
        sha256: createHash("sha256").update(output).digest("hex"),
        metadataStripped: true,
      },
    };
  }

  async #readMetadata(
    input: Buffer,
  ): Promise<{ ok: true; metadata: Metadata } | SharpImageSanitizerFailure> {
    const instance = createPipeline(input, this.#timeoutMs);
    try {
      return { ok: true, metadata: await this.#runAndDestroy(instance, instance.metadata()) };
    } catch (error) {
      return { ok: false, code: mapSharpError(error) };
    }
  }

  async #runAndDestroy<T>(instance: Sharp, operation: Promise<T>): Promise<T> {
    try {
      return await this.#timeoutPort.run(operation, this.#timeoutMs, () => instance.destroy());
    } finally {
      instance.destroy();
    }
  }
}

export function validateDecodedImageMetadata(
  metadata: DecodedImageMetadata,
  expectedFormat: "jpeg" | "png",
): { ok: true; width: number; height: number } | SharpImageSanitizerFailure {
  if (
    metadata.format !== expectedFormat ||
    metadata.width === undefined ||
    metadata.height === undefined ||
    !Number.isSafeInteger(metadata.width) ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    return { ok: false, code: "IMAGE_SANITIZER_DECODE_FAILED" };
  }
  if ((metadata.pages ?? 1) !== 1) {
    return { ok: false, code: "IMAGE_SANITIZER_MULTIPAGE_DISALLOWED" };
  }
  const pixels = metadata.width * metadata.height;
  if (!Number.isSafeInteger(pixels) || pixels > UPLOAD_LIMITS.imagePixels) {
    return { ok: false, code: "IMAGE_SANITIZER_PIXEL_LIMIT_EXCEEDED" };
  }
  return { ok: true, width: metadata.width, height: metadata.height };
}

export function validateDerivativeImageMetadata(
  metadata: DerivativeImageMetadata,
  expectedFormat: "jpeg" | "png",
): { ok: true; width: number; height: number } | SharpImageSanitizerFailure {
  const decoded = validateDecodedImageMetadata(metadata, expectedFormat);
  if (!decoded.ok) {
    return { ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" };
  }
  if (
    metadata.space !== "srgb" ||
    Math.max(decoded.width, decoded.height) > DERIVATIVE_MAX_LONG_EDGE ||
    metadata.orientation !== undefined ||
    metadata.exif !== undefined ||
    metadata.iptc !== undefined ||
    metadata.xmp !== undefined ||
    metadata.tifftagPhotoshop !== undefined
  ) {
    return { ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" };
  }
  return decoded;
}

export async function verifySharpDerivative(
  untrustedBytes: unknown,
  expectedMime: "image/jpeg" | "image/png",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  timeoutPort: SharpOperationTimeoutPort = new DefaultSharpOperationTimeoutPort(),
): Promise<{ ok: true; width: number; height: number } | SharpImageSanitizerFailure> {
  const bytes = toUint8Array(untrustedBytes);
  if (bytes === null || bytes.byteLength === 0) {
    return { ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" };
  }
  const expectedFormat = expectedMime === "image/jpeg" ? "jpeg" : "png";
  if (detectImageMagic(bytes) !== expectedFormat) {
    return { ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" };
  }
  const instance = createPipeline(Buffer.from(bytes), timeoutMs);
  try {
    const metadata = await timeoutPort.run(instance.metadata(), timeoutMs, () =>
      instance.destroy(),
    );
    return validateDerivativeImageMetadata(metadata, expectedFormat);
  } catch {
    return { ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" };
  } finally {
    instance.destroy();
  }
}

class DefaultSharpOperationTimeoutPort implements SharpOperationTimeoutPort {
  async run<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new SharpSanitizerTimeoutError("Sharp operation timed out"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

function createPipeline(input: Buffer, timeoutMs: number): Sharp {
  return sharp(input, {
    failOn: "warning",
    limitInputPixels: UPLOAD_LIMITS.imagePixels,
    limitInputChannels: 4,
    unlimited: false,
    sequentialRead: true,
    animated: false,
    pages: 1,
  }).timeout({ seconds: Math.max(1, Math.ceil(timeoutMs / 1_000)) });
}

function detectImageMagic(bytes: Uint8Array): "jpeg" | "png" | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return (
    bytes.byteLength >= prefix.length && prefix.every((value, index) => bytes[index] === value)
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

function mapSharpError(error: unknown): SharpImageSanitizerErrorCode {
  if (error instanceof SharpSanitizerTimeoutError) {
    return "IMAGE_SANITIZER_TIMEOUT";
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout") || message.includes("timed out")) {
    return "IMAGE_SANITIZER_TIMEOUT";
  }
  if (message.includes("pixel limit") || message.includes("exceeds pixel limit")) {
    return "IMAGE_SANITIZER_PIXEL_LIMIT_EXCEEDED";
  }
  return "IMAGE_SANITIZER_DECODE_FAILED";
}
