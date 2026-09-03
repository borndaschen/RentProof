import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { UPLOAD_LIMITS } from "@/domain/uploads";
import {
  SharpImageSanitizer,
  SharpSanitizerTimeoutError,
  validateDecodedImageMetadata,
  validateDerivativeImageMetadata,
  verifySharpDerivative,
  type SharpOperationTimeoutPort,
} from "./sharp-image-sanitizer";

async function jpeg(width = 40, height = 20): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

async function png(width = 40, height = 20): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 30, g: 90, b: 180, alpha: 0.8 } },
  })
    .png()
    .toBuffer();
}

describe("SharpImageSanitizer", () => {
  it("decodes and re-encodes allowlisted JPEG and PNG buffers", async () => {
    const sanitizer = new SharpImageSanitizer();
    const jpegResult = await sanitizer.sanitize(await jpeg(), "image/jpeg");
    const pngResult = await sanitizer.sanitize(await png(), "image/png");

    expect(jpegResult).toMatchObject({
      ok: true,
      derivative: {
        mime: "image/jpeg",
        format: "jpeg",
        width: 40,
        height: 20,
        colorSpace: "srgb",
        metadataStripped: true,
      },
    });
    expect(pngResult).toMatchObject({
      ok: true,
      derivative: { mime: "image/png", format: "png", width: 40, height: 20 },
    });
    if (jpegResult.ok) {
      expect(jpegResult.derivative.sha256).toBe(
        createHash("sha256").update(jpegResult.derivative.bytes).digest("hex"),
      );
    }
  });

  it("auto-orients an EXIF-rotated JPEG and removes orientation metadata", async () => {
    const orientationOne = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "red" },
    })
      .jpeg()
      .withExif({ IFD0: { Orientation: "1" } })
      .toBuffer();
    const oriented = patchExifOrientation(orientationOne, 6);
    const inputMetadata = await sharp(oriented).metadata();
    expect(inputMetadata.orientation).toBe(6);

    const result = await new SharpImageSanitizer().sanitize(oriented, "image/jpeg");
    expect(result).toMatchObject({ ok: true, derivative: { width: 20, height: 40 } });
    if (result.ok) {
      const outputMetadata = await sharp(result.derivative.bytes).metadata();
      expect(outputMetadata.orientation).toBeUndefined();
      expect(outputMetadata.exif).toBeUndefined();
    }
  });

  it("strips EXIF/GPS and XMP without preserving input metadata", async () => {
    const metadataFixture = await sharp({
      create: { width: 30, height: 20, channels: 3, background: "blue" },
    })
      .jpeg()
      .withExif({
        IFD0: { Artist: "Synthetic Person" },
        IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" },
      })
      .withXmp("<x:xmpmeta xmlns:x='adobe:ns:meta/'>synthetic</x:xmpmeta>")
      .toBuffer();
    const sourceMetadata = await sharp(metadataFixture).metadata();
    expect(sourceMetadata.exif).toBeDefined();
    expect(sourceMetadata.xmp).toBeDefined();

    const result = await new SharpImageSanitizer().sanitize(metadataFixture, "image/jpeg");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const outputMetadata = await sharp(result.derivative.bytes).metadata();
      expect(outputMetadata.exif).toBeUndefined();
      expect(outputMetadata.xmp).toBeUndefined();
      expect(outputMetadata.iptc).toBeUndefined();
      expect(outputMetadata.tifftagPhotoshop).toBeUndefined();
    }
  });

  it("converts to sRGB and caps the longest edge without enlargement", async () => {
    const cmyk = await sharp({
      create: { width: 4_000, height: 2_000, channels: 3, background: "#804020" },
    })
      .toColourspace("cmyk")
      .jpeg()
      .toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe("cmyk");

    const largeResult = await new SharpImageSanitizer().sanitize(cmyk, "image/jpeg");
    expect(largeResult).toMatchObject({
      ok: true,
      derivative: { width: 3_200, height: 1_600, colorSpace: "srgb" },
    });
    const smallResult = await new SharpImageSanitizer().sanitize(await png(100, 50), "image/png");
    expect(smallResult).toMatchObject({ ok: true, derivative: { width: 100, height: 50 } });
  });

  it("rejects truncated content, MIME mismatch, and non-JPEG/PNG formats", async () => {
    const sanitizer = new SharpImageSanitizer();
    await expect(
      sanitizer.sanitize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"),
    ).resolves.toEqual({ ok: false, code: "IMAGE_SANITIZER_DECODE_FAILED" });
    await expect(sanitizer.sanitize(await jpeg(), "image/png")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_MIME_MISMATCH",
    });
    await expect(
      sanitizer.sanitize(new TextEncoder().encode("GIF89a"), "image/png"),
    ).resolves.toEqual({ ok: false, code: "IMAGE_SANITIZER_UNSUPPORTED_MEDIA" });
    await expect(
      sanitizer.sanitize(new TextEncoder().encode("<svg></svg>"), "image/png"),
    ).resolves.toEqual({ ok: false, code: "IMAGE_SANITIZER_UNSUPPORTED_MEDIA" });
  });

  it("rejects file byte overflow and invalid input before decoding", async () => {
    const tooLarge = new Uint8Array(UPLOAD_LIMITS.imageBytes + 1);
    tooLarge.set([0xff, 0xd8, 0xff]);
    const sanitizer = new SharpImageSanitizer();
    await expect(sanitizer.sanitize(tooLarge, "image/jpeg")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_FILE_TOO_LARGE",
    });
    await expect(sanitizer.sanitize(new Uint8Array(), "image/png")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_INPUT_INVALID",
    });
    await expect(sanitizer.sanitize("not bytes", "image/png")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_INPUT_INVALID",
    });
    await expect(sanitizer.sanitize(await png(), "image/webp")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_UNSUPPORTED_MEDIA",
    });
  });

  it("lets Sharp reject a PNG decompression bomb at the 50M pixel boundary", async () => {
    const bomb = minimalPngHeader(10_000, 5_001);
    await expect(new SharpImageSanitizer().sanitize(bomb, "image/png")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_PIXEL_LIMIT_EXCEEDED",
    });
  });

  it("fails closed on a forced timeout", async () => {
    const sanitizer = new SharpImageSanitizer({ timeoutMs: 50, timeoutPort: new ForcedTimeout() });
    await expect(sanitizer.sanitize(await jpeg(), "image/jpeg")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_TIMEOUT",
    });
  });

  it("rejects invalid timeout configuration", () => {
    expect(() => new SharpImageSanitizer({ timeoutMs: 0 })).toThrow(RangeError);
  });
});

describe("metadata and derivative validation", () => {
  it("rejects pixel bombs and multipage/animated metadata", () => {
    expect(
      validateDecodedImageMetadata(
        { format: "png", width: 10_000, height: 5_001, pages: 1 },
        "png",
      ),
    ).toEqual({ ok: false, code: "IMAGE_SANITIZER_PIXEL_LIMIT_EXCEEDED" });
    expect(
      validateDecodedImageMetadata({ format: "png", width: 10, height: 20, pages: 2 }, "png"),
    ).toEqual({ ok: false, code: "IMAGE_SANITIZER_MULTIPAGE_DISALLOWED" });
    expect(
      validateDecodedImageMetadata({ format: "gif", width: 10, height: 20, pages: 1 }, "png"),
    ).toEqual({ ok: false, code: "IMAGE_SANITIZER_DECODE_FAILED" });
  });

  it.each(["exif", "iptc", "xmp", "tifftagPhotoshop"] as const)(
    "rejects derivative %s metadata",
    (field) => {
      expect(
        validateDerivativeImageMetadata(
          {
            format: "jpeg",
            width: 100,
            height: 50,
            pages: 1,
            space: "srgb",
            [field]: Uint8Array.of(1),
          },
          "jpeg",
        ),
      ).toEqual({ ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" });
    },
  );

  it("rejects non-sRGB, oversized, oriented, malformed, and wrong-magic derivatives", async () => {
    expect(
      validateDerivativeImageMetadata(
        { format: "jpeg", width: 100, height: 50, pages: 1, space: "cmyk" },
        "jpeg",
      ),
    ).toEqual({ ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" });
    expect(
      validateDerivativeImageMetadata(
        { format: "jpeg", width: 3_201, height: 50, pages: 1, space: "srgb" },
        "jpeg",
      ),
    ).toEqual({ ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" });
    expect(
      validateDerivativeImageMetadata(
        { format: "jpeg", width: 100, height: 50, pages: 1, space: "srgb", orientation: 1 },
        "jpeg",
      ),
    ).toEqual({ ok: false, code: "IMAGE_SANITIZER_DERIVATIVE_INVALID" });
    await expect(verifySharpDerivative(new Uint8Array(), "image/jpeg")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_DERIVATIVE_INVALID",
    });
    await expect(verifySharpDerivative(await png(), "image/jpeg")).resolves.toEqual({
      ok: false,
      code: "IMAGE_SANITIZER_DERIVATIVE_INVALID",
    });
  });

  it("re-reads a valid derivative", async () => {
    await expect(verifySharpDerivative(await jpeg(), "image/jpeg")).resolves.toMatchObject({
      ok: true,
      width: 40,
      height: 20,
    });
  });
});

class ForcedTimeout implements SharpOperationTimeoutPort {
  async run<T>(operation: Promise<T>, _timeoutMs: number, onTimeout: () => void): Promise<T> {
    onTimeout();
    await operation.catch(() => undefined);
    throw new SharpSanitizerTimeoutError("forced timeout");
  }
}

function patchExifOrientation(input: Buffer, orientation: number): Buffer {
  const output = Buffer.from(input);
  const exifMarker = Buffer.from("Exif\0\0", "binary");
  const exifIndex = output.indexOf(exifMarker);
  if (exifIndex < 0) {
    throw new Error("EXIF fixture missing");
  }
  const tiffStart = exifIndex + exifMarker.byteLength;
  const littleEndian = output.toString("ascii", tiffStart, tiffStart + 2) === "II";
  const read16 = (offset: number) =>
    littleEndian ? output.readUInt16LE(offset) : output.readUInt16BE(offset);
  const read32 = (offset: number) =>
    littleEndian ? output.readUInt32LE(offset) : output.readUInt32BE(offset);
  const ifdStart = tiffStart + read32(tiffStart + 4);
  const entryCount = read16(ifdStart);
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifdStart + 2 + index * 12;
    if (read16(entry) === 0x0112) {
      if (littleEndian) {
        output.writeUInt16LE(orientation, entry + 8);
      } else {
        output.writeUInt16BE(orientation, entry + 8);
      }
      return output;
    }
  }
  throw new Error("EXIF orientation tag missing");
}

function minimalPngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.byteLength);
  output.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.byteLength);
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
