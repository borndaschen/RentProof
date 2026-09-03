import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveSession: vi.fn(),
  cookieSet: vi.fn(),
  close: vi.fn(),
  listOwned: vi.fn(),
  findOwned: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet }),
}));
vi.mock("@/server/env", () => ({
  getServerEnvironment: () => ({
    RENTPROOF_AUTH_MODE: "self_hosted",
    RENTPROOF_DEPLOYMENT_PROFILE: "local_development",
    RENTPROOF_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
    allowedHosts: ["127.0.0.1:3000"],
    allowedOrigins: ["http://127.0.0.1:3000"],
  }),
}));
vi.mock("@/server/auth/runtime", () => ({
  getSelfHostedAuthRuntime: async () => ({ service: { resolveSession: mocks.resolveSession } }),
}));
vi.mock("@/adapters/database/postgres", () => ({
  parsePostgresDatabaseConfig: () => ({ role: "app", environment: "synthetic_demo" }),
  createPostgresRuntime: () => ({ database: {}, close: mocks.close }),
  PostgresCaseHistoryRepository: class {
    listOwned = mocks.listOwned;
    findOwned = mocks.findOwned;
  },
}));

import { HistoryAccessError } from "@/application/history";
import { listCurrentActorHistory } from "./runtime";

const sessionToken = "s".repeat(43);

describe("self-hosted history runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RENTPROOF_DATABASE_ADAPTER", "postgres");
    mocks.close.mockResolvedValue(undefined);
    mocks.listOwned.mockResolvedValue([]);
  });

  it("slides both DB idle expiry and browser Max-Age on eligible owner-scoped history access", async () => {
    mocks.resolveSession.mockResolvedValue({
      status: "authenticated",
      actor: { kind: "user", userId: "user_a", sessionId: "session_a" },
      reverified: false,
      refreshCookie: { token: sessionToken, maxAgeSeconds: 604_800 },
    });
    const result = await listCurrentActorHistory(
      new Request("http://127.0.0.1:3000/api/history", {
        headers: { cookie: `rentproof_account_dev=${sessionToken}` },
      }),
    );
    expect(result).toEqual([]);
    expect(mocks.resolveSession).toHaveBeenCalledWith(sessionToken, true);
    expect(mocks.cookieSet).toHaveBeenCalledWith({
      name: "rentproof_account_dev",
      value: sessionToken,
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
      maxAge: 604_800,
      expires: expect.any(Date),
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("does not create or refresh a cookie for a signed-out request", async () => {
    mocks.resolveSession.mockResolvedValue({ status: "signed_out" });
    await expect(
      listCurrentActorHistory(new Request("http://127.0.0.1:3000/api/history")),
    ).rejects.toBeInstanceOf(HistoryAccessError);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
