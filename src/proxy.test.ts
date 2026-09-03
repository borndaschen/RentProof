import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerEnvironment } = vi.hoisted(() => ({
  getServerEnvironment: vi.fn(),
}));
vi.mock("@/server/env", () => ({ getServerEnvironment }));

const safeEnvironment = {
  allowedHosts: ["127.0.0.1:3000"],
  RENTPROOF_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  RENTPROOF_AUTH_MODE: "synthetic",
};

import proxy, { config } from "./proxy";

function request(path = "/api/runtime-status", headers: Record<string, string> = {}) {
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    headers: { host: "127.0.0.1:3000", ...headers },
  });
}

describe("global proxy network boundary", () => {
  beforeEach(() => {
    getServerEnvironment.mockReset();
    getServerEnvironment.mockReturnValue(safeEnvironment);
  });

  it("uses a constant matcher for pages, APIs, and static assets", () => {
    expect(config).toEqual({ matcher: ["/:path*"] });
    for (const url of ["/", "/api/runtime-status", "/_next/static/chunks/app.js", "/favicon.ico"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    }
  });

  it("allows an exact Host without requiring Origin for GET", () => {
    const response = proxy(request()) as Response;
    expect(response.status).toBe(200);
  });

  it("rejects an unlisted Host before auth without exposing configuration", async () => {
    const response = proxy(
      request("/api/runtime-status", { host: "evil.invalid:3000" }),
    ) as Response;
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "REQUEST_NETWORK_BOUNDARY_REJECTED" });
    expect(body).not.toContain("127.0.0.1");
  });

  it("applies Host validation to static assets without a vendor auth middleware", () => {
    expect((proxy(request("/_next/static/chunks/app.js")) as Response).status).toBe(200);
    expect(
      (
        proxy(
          request("/_next/static/chunks/app.js", { "x-forwarded-host": "evil.invalid:3000" }),
        ) as Response
      ).status,
    ).toBe(400);
  });

  it("fails closed before auth when server environment validation fails", async () => {
    getServerEnvironment.mockImplementation(() => {
      throw new Error("configuration detail");
    });
    const response = proxy(request()) as Response;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "REQUEST_NETWORK_BOUNDARY_REJECTED" });
  });
});
