import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node:https", () => ({ default: { request: mocks.request }, request: mocks.request }));
vi.mock("node:dns/promises", () => ({
  default: { lookup: mocks.lookup },
  lookup: mocks.lookup,
}));

import { createListingUrlFetcher } from "./fetcher";

type FakeResponse = EventEmitter & {
  headers: Record<string, string>;
  statusCode: number;
  destroy(error?: Error): void;
};

type FakeRequest = EventEmitter & {
  setTimeout(milliseconds: number, callback: () => void): void;
  destroy(error: Error): void;
  end(): void;
};

function installTransport(input?: {
  remoteAddress?: string;
  contentLength?: string;
  contentType?: string;
  body?: string;
  timeout?: boolean;
}) {
  mocks.request.mockImplementation(
    (_options: unknown, callback: (response: FakeResponse) => void): FakeRequest => {
      const request = new EventEmitter() as FakeRequest;
      let timeoutCallback: (() => void) | undefined;
      request.setTimeout = (_milliseconds, candidate) => {
        timeoutCallback = candidate;
      };
      request.destroy = (error) => request.emit("error", error);
      request.end = () => {
        if (input?.timeout) {
          timeoutCallback?.();
          return;
        }
        const socket = new EventEmitter() as EventEmitter & { remoteAddress: string };
        socket.remoteAddress = input?.remoteAddress ?? "8.8.8.8";
        request.emit("socket", socket);
        socket.emit("connect");
        const response = new EventEmitter() as FakeResponse;
        response.statusCode = 200;
        response.headers = {
          "content-type": input?.contentType ?? "text/html; charset=utf-8",
          ...(input?.contentLength ? { "content-length": input.contentLength } : {}),
        };
        response.destroy = (error) => {
          if (error) response.emit("error", error);
        };
        callback(response);
        response.emit("data", Buffer.from(input?.body ?? "<p>租屋廣告</p>", "utf8"));
        response.emit("end");
      };
      return request;
    },
  );
}

function fetcher() {
  return createListingUrlFetcher({
    allowedHosts: ["rent.example"],
    resolve: async () => ["8.8.8.8"],
  });
}

function fetcherWithDefaultResolver() {
  return createListingUrlFetcher({ allowedHosts: ["rent.example"] });
}

describe("pinned HTTPS listing transport", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  });

  it("connects to the already verified address while preserving TLS server name", async () => {
    installTransport();
    await expect(
      fetcherWithDefaultResolver().fetch("https://rent.example/item/1"),
    ).resolves.toMatchObject({
      html: "<p>租屋廣告</p>",
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "8.8.8.8", servername: "rent.example" }),
      expect.any(Function),
    );
  });

  it("rejects peer-address changes, declared oversized bodies, and timeouts", async () => {
    installTransport({ remoteAddress: "127.0.0.1" });
    await expect(fetcher().fetch("https://rent.example/")).rejects.toMatchObject({
      code: "UNSAFE_ADDRESS",
    });
    installTransport({ contentLength: String(1024 * 1024 + 1) });
    await expect(fetcher().fetch("https://rent.example/")).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
    installTransport({ timeout: true });
    await expect(fetcher().fetch("https://rent.example/")).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    installTransport({ body: "x".repeat(1024 * 1024 + 1) });
    await expect(fetcher().fetch("https://rent.example/")).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });
});
