import { describe, expect, it, vi } from "vitest";
import { createListingUrlFetcher } from "./fetcher";
import { ListingUrlError } from "../../application/listing-url/contracts";

describe("listing URL fetcher guards", () => {
  it("rejects credentials, fragments and non-standard ports", async () => {
    const fetcher = createListingUrlFetcher({
      allowedHosts: ["example.test"],
      resolve: async () => ["93.184.216.34"],
    });
    for (const url of [
      "https://user:pass@example.test/",
      "https://example.test/#x",
      "https://example.test:444/",
    ]) {
      await expect(fetcher.fetch(url)).rejects.toBeInstanceOf(ListingUrlError);
    }
    await expect(fetcher.fetch("not a url")).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(fetcher.fetch("https://other.example/")).rejects.toMatchObject({
      code: "HOST_NOT_ALLOWED",
    });
  });
  it("rejects private DNS results before network access", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const fetcher = createListingUrlFetcher({
      allowedHosts: ["example.test"],
      resolve: async () => ["127.0.0.1"],
    });
    await expect(fetcher.fetch("https://example.test/")).rejects.toMatchObject({
      code: "UNSAFE_ADDRESS",
    });
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it("pins the validated public address and returns only HTML", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      location: null,
      mediaType: "text/html; charset=utf-8",
      body: new TextEncoder().encode("<h1>公開租屋</h1>"),
    }));
    const fetcher = createListingUrlFetcher({
      allowedHosts: ["rent.example"],
      resolve: async () => ["8.8.8.8"],
      request,
    });
    await expect(fetcher.fetch("https://rent.example/item?id=1")).resolves.toEqual({
      sourceUrl: "https://rent.example/item?id=1",
      html: "<h1>公開租屋</h1>",
    });
    expect(request).toHaveBeenCalledWith(
      new URL("https://rent.example/item?id=1"),
      "8.8.8.8",
      10_000,
    );
  });

  it("revalidates every redirect and rejects non-HTML or failed pages", async () => {
    const redirect = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        location: "/final",
        mediaType: "text/html",
        body: new Uint8Array(),
      })
      .mockResolvedValueOnce({
        status: 200,
        location: null,
        mediaType: "text/html",
        body: new TextEncoder().encode("final"),
      });
    const fetcher = createListingUrlFetcher({
      allowedHosts: ["rent.example"],
      resolve: async () => ["8.8.4.4"],
      request: redirect,
    });
    await expect(fetcher.fetch("https://rent.example/start")).resolves.toMatchObject({
      sourceUrl: "https://rent.example/final",
    });

    for (const response of [
      { status: 500, location: null, mediaType: "text/html", body: new Uint8Array() },
      { status: 200, location: null, mediaType: "application/json", body: new Uint8Array() },
    ]) {
      await expect(
        createListingUrlFetcher({
          allowedHosts: ["rent.example"],
          resolve: async () => ["8.8.8.8"],
          request: async () => response,
        }).fetch("https://rent.example/"),
      ).rejects.toBeInstanceOf(ListingUrlError);
    }
  });

  it("maps transport, redirect, and encoding failures to distinct typed errors", async () => {
    const base = { allowedHosts: ["rent.example"], resolve: async () => ["8.8.8.8"] } as const;
    await expect(
      createListingUrlFetcher({
        ...base,
        request: async () => {
          throw new Error("socket private detail");
        },
      }).fetch("https://rent.example/"),
    ).rejects.toMatchObject({ code: "FETCH_FAILED" });
    await expect(
      createListingUrlFetcher({
        ...base,
        request: async () => ({
          status: 302,
          location: null,
          mediaType: "text/html",
          body: new Uint8Array(),
        }),
      }).fetch("https://rent.example/"),
    ).rejects.toMatchObject({ code: "REDIRECT_LIMIT" });
    await expect(
      createListingUrlFetcher({
        ...base,
        request: async () => ({
          status: 200,
          location: null,
          mediaType: "text/html",
          body: Uint8Array.of(0xff),
        }),
      }).fetch("https://rent.example/"),
    ).rejects.toMatchObject({ code: "INVALID_ENCODING" });
  });

  it.each(["::1", "::ffff:172.16.0.1", "169.254.1.1", "100.64.0.1", "203.0.113.1"])(
    "rejects reserved address %s",
    async (address) => {
      const fetcher = createListingUrlFetcher({
        allowedHosts: ["rent.example"],
        resolve: async () => [address],
      });
      await expect(fetcher.fetch("https://rent.example/")).rejects.toMatchObject({
        code: "UNSAFE_ADDRESS",
      });
    },
  );
});
