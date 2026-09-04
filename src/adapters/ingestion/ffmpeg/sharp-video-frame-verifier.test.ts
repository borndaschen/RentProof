import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SharpVideoFrameVerifier } from "./sharp-video-frame-verifier";

function frame() {
  const bytes = Uint8Array.from(
    Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
      "base64",
    ),
  );
  return {
    mime: "image/jpeg" as const,
    frameNo: 0,
    timestampMs: 0,
    width: 1,
    height: 1,
    byteLength: bytes.byteLength,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    metadataStripped: true as const,
  };
}

describe("SharpVideoFrameVerifier", () => {
  it("verifies decoded dimensions and content digest", async () => {
    const candidate = frame();
    await expect(new SharpVideoFrameVerifier().verify(candidate)).resolves.toBe(true);
  });

  it("rejects mismatched dimensions, digest, and invalid image bytes", async () => {
    const candidate = frame();
    const verifier = new SharpVideoFrameVerifier();
    await expect(verifier.verify({ ...candidate, width: 2 })).resolves.toBe(false);
    await expect(verifier.verify({ ...candidate, sha256: "0".repeat(64) })).resolves.toBe(false);
    await expect(
      verifier.verify({
        ...candidate,
        bytes: new Uint8Array([1, 2, 3]),
        byteLength: 3,
        sha256: createHash("sha256")
          .update(new Uint8Array([1, 2, 3]))
          .digest("hex"),
      }),
    ).resolves.toBe(false);
  });
});
