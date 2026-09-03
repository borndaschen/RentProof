import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { HistoryClientPage } from "./history-client-page";

const mockedFetch = vi.fn<typeof fetch>();

describe("HistoryClientPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockedFetch);
  });

  it("renders an authentication prompt without exposing response internals", async () => {
    mockedFetch.mockResolvedValue(new Response("secret backend detail", { status: 401 }));
    const { container } = render(<HistoryClientPage />);
    expect(await screen.findByRole("heading", { name: "請先登入" })).toBeVisible();
    expect(screen.queryByText(/secret backend detail/iu)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往登入／註冊" })).toHaveAttribute("href", "/auth");
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it("parses and renders only the typed owner-scoped history response", async () => {
    mockedFetch.mockResolvedValue(
      Response.json({
        schemaVersion: "rentproof.case-history.v1",
        cases: [
          {
            caseId: "case_owner_scoped_00000001",
            displayName: "南京東路套房",
            status: "ready",
            updatedAt: "2026-09-03T00:00:00.000Z",
          },
        ],
      }),
    );
    render(<HistoryClientPage />);
    expect(await screen.findByText("南京東路套房")).toBeVisible();
    expect(mockedFetch).toHaveBeenCalledWith("/api/history", {
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("fails closed on an untyped payload", async () => {
    mockedFetch.mockResolvedValue(Response.json({ cases: [{ displayName: "injected" }] }));
    render(<HistoryClientPage />);
    expect(await screen.findByRole("heading", { name: "歷史案件目前無法使用" })).toBeVisible();
    expect(screen.queryByText("injected")).not.toBeInTheDocument();
  });
});
