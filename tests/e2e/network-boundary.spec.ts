import { expect, test } from "@playwright/test";

test("global network boundary accepts the configured Host and rejects Host spoofing", async ({
  request,
}) => {
  expect((await request.get("/api/runtime-status")).status()).toBe(200);
  const rejected = await request.get("/api/runtime-status", {
    headers: { host: "evil.invalid:3000" },
  });
  expect(rejected.status()).toBeGreaterThanOrEqual(400);
  expect(rejected.status()).toBeLessThan(500);
  expect(await rejected.json()).toEqual({ error: "REQUEST_NETWORK_BOUNDARY_REJECTED" });
});

test("global network boundary rejects forwarded host, protocol, port, and chain spoofing", async ({
  request,
}) => {
  for (const headers of [
    { "x-forwarded-host": "evil.invalid:3000" },
    { "x-forwarded-proto": "https" },
    { "x-forwarded-port": "80" },
    { forwarded: "for=198.51.100.2;host=evil.invalid" },
    { "x-forwarded-for": "198.51.100.2, 127.0.0.1" },
  ]) {
    const response = await request.get("/api/runtime-status", { headers });
    expect(response.status()).toBe(400);
  }
});
