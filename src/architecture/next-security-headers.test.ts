import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next security headers", () => {
  it("keeps script attributes, framing, cross-origin resources, and browser capabilities closed", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers?.();
    const headers = new Map(
      rules?.flatMap((rule) => rule.headers.map((header) => [header.key, header.value] as const)),
    );
    expect(headers.get("Content-Security-Policy")).toContain("script-src-attr 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("X-Permitted-Cross-Domain-Policies")).toBe("none");
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    );
  });
});
