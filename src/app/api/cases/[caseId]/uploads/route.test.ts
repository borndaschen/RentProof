import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  sourceIp: vi.fn(() => "192.168.1.20"),
}));

vi.mock("@/server/uploads/runtime", () => ({
  getSyntheticUploadService: () => ({ handle: runtimeMocks.handle }),
  getSyntheticUploadSourceBucketKey: runtimeMocks.sourceIp,
}));

import { POST } from "./route";

const requestHeaders = {
  host: "192.168.1.20:3000",
  origin: "http://192.168.1.20:3000",
  "content-type": "application/octet-stream",
};

describe("POST synthetic upload route", () => {
  beforeEach(() => {
    runtimeMocks.handle.mockReset();
    runtimeMocks.sourceIp.mockClear();
  });

  it("passes one raw body stream to the service and returns only its typed receipt", async () => {
    const receipt = {
      schemaVersion: "rentproof.synthetic-upload-receipt.v1",
      receiptId: "receipt_abcdefghijklmnopqr",
      kind: "listing",
      originalSha256: "a".repeat(64),
      derivativeSha256: "b".repeat(64),
      media: { type: "image", mime: "image/png", width: 640, height: 480 },
    };
    runtimeMocks.handle.mockImplementationOnce(async (transport) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of transport.stream) {
        if (ArrayBuffer.isView(chunk)) {
          chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        }
      }
      expect(chunks).toEqual([Uint8Array.of(1, 2, 3)]);
      expect(transport.caseId).toBe("golden-v1");
      expect(transport.sourceIp).toBe("192.168.1.20");
      expect(transport.headers.get("origin")).toBe(requestHeaders.origin);
      return { ok: true, status: 201, receipt };
    });

    const response = await POST(
      new Request("http://192.168.1.20:3000/api/cases/golden-v1/uploads", {
        method: "POST",
        headers: requestHeaders,
        body: Uint8Array.of(1, 2, 3),
      }),
      { params: Promise.resolve({ caseId: "golden-v1" }) },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(receipt);
  });

  it("returns typed errors without provider details", async () => {
    runtimeMocks.handle.mockResolvedValueOnce({
      ok: false,
      status: 429,
      code: "UPLOAD_RATE_LIMITED",
      retryAfterSeconds: 6,
    });
    const response = await POST(
      new Request("http://192.168.1.20:3000/api/cases/golden-v1/uploads", {
        method: "POST",
        headers: requestHeaders,
      }),
      { params: Promise.resolve({ caseId: "golden-v1" }) },
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: {
        code: "UPLOAD_RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: 6,
      },
    });
  });
});
