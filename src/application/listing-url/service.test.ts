import { describe, expect, it } from "vitest";
import { createListingUrlService } from "./service";

describe("listing URL text extraction", () => {
  it("removes non-content elements and emits locators", async () => {
    const service = createListingUrlService({
      fetch: async () => ({
        sourceUrl: "https://example.test/a",
        html: "<script>x</script><h1>Rent</h1>\n<style>bad</style><p>5000 &amp; utilities</p>",
      }),
    });
    const result = await service.extract("https://example.test/a");
    expect(result.text).toContain("Rent");
    expect(result.text).toContain("5000 & utilities");
    expect(result.text).not.toContain("bad");
    expect(result.segments[0]?.locator.line).toBe(1);
  });

  it("keeps repeated lines independently locatable", async () => {
    const service = createListingUrlService({
      fetch: async () => ({
        sourceUrl: "https://example.test/a",
        html: "<p>相同文字</p><p>相同文字</p>",
      }),
    });
    const result = await service.extract("https://example.test/a");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1]?.locator.start).toBeGreaterThan(
      result.segments[0]?.locator.start ?? 0,
    );
  });
});
