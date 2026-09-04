import { afterEach, describe, expect, it, vi } from "vitest";
import { validateSubsidyPrecheckRequest } from "@/server/subsidy/request-boundary";

vi.mock("server-only", () => ({}));

const environment = {
  allowedHosts: ["127.0.0.1:3000"],
  allowedOrigins: ["http://127.0.0.1:3000"],
} as const;

vi.mock("@/server/env", () => ({
  getServerEnvironment: () => environment,
}));

const validInput = {
  applicationDate: "unknown",
  rentalCountyCity: "臺北市",
  nationalityAndRegistration: "unknown",
  ageBasis: "unknown",
  householdHomeOwnership: "unknown",
  incomeThresholdBasis: "unknown",
  incomeComparedWithApplicableThreshold: "unknown",
  otherHousingAssistance: "unknown",
  leaseTiming: "unknown",
  buildingBasis: "unknown",
  applicantIsNamedLeaseholder: "unknown",
  leaseIsGenuine: "unknown",
  landlordOrOwnerIsHouseholdMemberOrLinealRelative: "unknown",
  housingProgramType: "unknown",
  monthlyRentTwd: "unknown",
  leaseUseIncludesResidence: "unknown",
  is24HourCareInstitution: "unknown",
} as const;

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/rent-subsidy/precheck", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  });
}

describe("rent subsidy precheck request boundary", () => {
  it("accepts an exact same-origin JSON request", () => {
    expect(validateSubsidyPrecheckRequest(request(), environment)).toBeNull();
  });

  it.each([
    [{ host: "attacker.invalid" }, 403, "SUBSIDY_PRECHECK_HOST_FORBIDDEN"],
    [{ origin: "https://attacker.invalid" }, 403, "SUBSIDY_PRECHECK_ORIGIN_FORBIDDEN"],
    [{ "content-type": "text/plain" }, 415, "SUBSIDY_PRECHECK_CONTENT_TYPE_UNSUPPORTED"],
    [{ forwarded: "for=127.0.0.1" }, 403, "SUBSIDY_PRECHECK_FORWARDED_HEADER_FORBIDDEN"],
    [
      { "x-forwarded-host": "attacker.invalid" },
      403,
      "SUBSIDY_PRECHECK_FORWARDED_HEADER_FORBIDDEN",
    ],
    [{ "x-forwarded-proto": "https" }, 403, "SUBSIDY_PRECHECK_FORWARDED_HEADER_FORBIDDEN"],
  ])("rejects an invalid boundary with %s", (headers, status, code) => {
    expect(validateSubsidyPrecheckRequest(request(headers), environment)).toEqual({ status, code });
  });
});

describe("POST /api/rent-subsidy/precheck", () => {
  afterEach(() => vi.useRealTimers());

  it("returns a strict, private result while the official source snapshot is current", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00+08:00"));
    const { POST } = await import("./route");
    const response = await POST(
      requestWithBody({
        schemaVersion: "rentproof.rent-subsidy-precheck-input.v1",
        input: validInput,
      }),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toMatchObject({
      schema: "rentproof.rental-subsidy-precheck.v1",
      overallStatus: "insufficient_information",
      officialDeterminationRequired: true,
    });
  });

  it("fails closed when the official source snapshot is stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T00:00:01+08:00"));
    const { POST } = await import("./route");
    const response = await POST(
      requestWithBody({
        schemaVersion: "rentproof.rent-subsidy-precheck-input.v1",
        input: validInput,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SUBSIDY_SOURCE_STALE" },
    });
  });

  it("rejects unknown request properties without evaluating a result", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      requestWithBody({
        schemaVersion: "rentproof.rent-subsidy-precheck-input.v1",
        input: validInput,
        unexpected: true,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SUBSIDY_PRECHECK_REQUEST_INVALID" },
    });
  });

  it("rejects a streamed body over the hard byte limit", async () => {
    const { POST } = await import("./route");
    const response = await POST(requestWithBody("x".repeat(4_097)));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SUBSIDY_PRECHECK_REQUEST_TOO_LARGE" },
    });
  });
});

function requestWithBody(body: unknown): Request {
  return new Request("http://127.0.0.1:3000/api/rent-subsidy/precheck", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
