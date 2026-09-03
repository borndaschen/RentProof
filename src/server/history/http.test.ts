import { describe, expect, it, vi } from "vitest";
import { HistoryAccessError } from "@/application/history";
import { HistoryRuntimeError } from "./runtime";
import { historyErrorResponse } from "./http";

vi.mock("server-only", () => ({}));

describe("historyErrorResponse", () => {
  it("uses the same 404 for invisible and other-owned case ids", async () => {
    const response = historyErrorResponse(new HistoryAccessError("HISTORY_NOT_FOUND_OR_FORBIDDEN"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "HISTORY_NOT_FOUND_OR_FORBIDDEN",
        message: "找不到案件，或目前帳戶無權存取。",
      },
    });
  });

  it("denies unauthenticated access and disables LAN/synthetic history", async () => {
    expect(
      historyErrorResponse(new HistoryAccessError("HISTORY_AUTHENTICATION_REQUIRED")).status,
    ).toBe(401);
    const disabled = historyErrorResponse(new HistoryRuntimeError("HISTORY_FEATURE_DISABLED"));
    expect(disabled.status).toBe(404);
    expect(await disabled.text()).not.toMatch(/clerk|postgres|credential|secret/iu);
  });

  it("fails closed without leaking configuration details", async () => {
    const response = historyErrorResponse(new HistoryRuntimeError("HISTORY_DATABASE_UNCONFIGURED"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("RENTPROOF_DATABASE_URL");
  });
});
