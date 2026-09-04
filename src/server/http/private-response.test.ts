import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("private response headers", () => {
  it("returns a fresh no-store and nosniff header record", async () => {
    const { privateNoStoreHeaders } = await import("./private-response");
    const first = privateNoStoreHeaders();
    const second = privateNoStoreHeaders();
    expect(new Headers(first).get("Cache-Control")).toBe("private, no-store");
    expect(new Headers(first).get("Pragma")).toBe("no-cache");
    expect(new Headers(first).get("X-Content-Type-Options")).toBe("nosniff");
    expect(first).not.toBe(second);
  });
});
