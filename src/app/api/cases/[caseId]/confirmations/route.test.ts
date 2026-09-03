import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({
    allowedHosts: ["127.0.0.1:3000"],
    allowedOrigins: ["http://127.0.0.1:3000"],
  }),
}));

import { POST as consumeConfirmation } from "./[confirmationId]/route";
import { POST as issueConfirmation } from "./route";

const headers = {
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  "content-type": "application/json",
};

function post(url: string, body: string, extraHeaders: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { ...headers, ...extraHeaders },
    body,
  });
}

async function issue() {
  const response = await issueConfirmation(
    post(
      "http://127.0.0.1:3000/api/cases/golden-v1/confirmations",
      JSON.stringify({ candidateKey: "fixture_electricity_payer_tenant" }),
    ),
    { params: Promise.resolve({ caseId: "golden-v1" }) },
  );
  const body = (await response.json()) as {
    ok: true;
    confirmationId: string;
    csrfToken: string;
  };
  expect(response.status).toBe(201);
  expect(body.ok).toBe(true);
  return body;
}

describe.sequential("confirmation routes", () => {
  it("performs issue → CSRF consume → revision +1 and rejects replay", async () => {
    const pending = await issue();
    const url = `http://127.0.0.1:3000/api/cases/golden-v1/confirmations/${pending.confirmationId}`;
    const consumed = await consumeConfirmation(
      post(url, "{}", { "x-csrf-token": pending.csrfToken }),
      {
        params: Promise.resolve({
          caseId: "golden-v1",
          confirmationId: pending.confirmationId,
        }),
      },
    );
    expect(consumed.status).toBe(200);
    await expect(consumed.json()).resolves.toEqual({ ok: true, revision: 1 });

    const replay = await consumeConfirmation(
      post(url, "{}", { "x-csrf-token": pending.csrfToken }),
      {
        params: Promise.resolve({
          caseId: "golden-v1",
          confirmationId: pending.confirmationId,
        }),
      },
    );
    expect(replay.status).toBe(403);
    await expect(replay.json()).resolves.toEqual({
      ok: false,
      code: "CONFIRMATION_CSRF_INVALID",
    });
  });

  it("does not consume when the CSRF token is wrong", async () => {
    const pending = await issue();
    const params = {
      caseId: "golden-v1",
      confirmationId: pending.confirmationId,
    };
    const url = `http://127.0.0.1:3000/api/cases/golden-v1/confirmations/${pending.confirmationId}`;
    const wrong = await consumeConfirmation(
      post(url, "{}", { "x-csrf-token": "wrong_csrf_token_00001" }),
      { params: Promise.resolve(params) },
    );
    expect(wrong.status).toBe(403);

    const correct = await consumeConfirmation(
      post(url, "{}", { "x-csrf-token": pending.csrfToken }),
      { params: Promise.resolve(params) },
    );
    expect(correct.status).toBe(200);
    await expect(correct.json()).resolves.toMatchObject({ ok: true, revision: 2 });
  });

  it("rejects Host, Origin, forwarded metadata, invalid case, and oversized JSON", async () => {
    const baseUrl = "http://127.0.0.1:3000/api/cases/golden-v1/confirmations";
    const body = JSON.stringify({ candidateKey: "fixture_electricity_payer_tenant" });
    for (const forbiddenHeaders of [
      { host: "attacker.example" },
      { origin: "http://attacker.example" },
      { forwarded: "for=192.0.2.1" },
    ]) {
      const response = await issueConfirmation(post(baseUrl, body, forbiddenHeaders), {
        params: Promise.resolve({ caseId: "golden-v1" }),
      });
      expect(response.status).toBe(403);
    }
    const wrongCase = await issueConfirmation(post(baseUrl, body), {
      params: Promise.resolve({ caseId: "golden-v2" }),
    });
    expect(wrongCase.status).toBe(404);

    const oversized = await issueConfirmation(
      post(baseUrl, JSON.stringify({ x: "x".repeat(1_024) })),
      {
        params: Promise.resolve({ caseId: "golden-v1" }),
      },
    );
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toEqual({
      error: { code: "CONFIRMATION_REQUEST_INVALID" },
    });
  });

  it("keeps the Fixture conversation route free of static OpenAI or Live imports", () => {
    const source = readFileSync("src/app/api/cases/[caseId]/conversation/turns/route.ts", "utf8");
    expect(source).not.toMatch(/^import .*openai/im);
    expect(source).not.toMatch(/^import .*conversation\/live\/runtime/im);
    expect(source).toContain('await import("@/server/conversation/live/runtime")');
  });
});
