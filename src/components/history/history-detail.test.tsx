import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { HistoryDetail } from "./history-detail";

describe("HistoryDetail", () => {
  it.each([
    ["fixture", "已整理的資料"],
    ["live", "OpenAI 雲端分析"],
  ] as const)("renders an accessible %s owner-scoped case summary", async (sourceMode, label) => {
    const { container } = render(
      <HistoryDetail
        rentalCase={{
          caseId: "case_owned_00000001",
          displayName: "信義路套房",
          status: "needs_attention",
          revision: 3,
          sourceMode,
          createdAt: "2026-09-03T01:00:00.000Z",
          updatedAt: "2026-09-03T02:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "信義路套房" })).toBeVisible();
    expect(screen.getByRole("link", { name: /返回/u })).toHaveAttribute("href", "/history");
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect((await axe(container)).violations).toHaveLength(0);
    expect(container).not.toHaveTextContent(/Demo|Fixture|Golden|P0|Synthetic|虛構/u);
  });
});
