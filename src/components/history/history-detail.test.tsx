import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { HistoryDetail } from "./history-detail";

describe("HistoryDetail", () => {
  it.each([
    ["fixture", "Fixture"],
    ["live", "OpenAI Live"],
  ] as const)("renders an accessible %s owner-scoped case summary", async (sourceMode, label) => {
    const { container } = render(
      <HistoryDetail
        rentalCase={{
          caseId: "case_owned_00000001",
          displayName: "虛構測試套房",
          status: "needs_attention",
          revision: 3,
          sourceMode,
          createdAt: "2026-09-03T01:00:00.000Z",
          updatedAt: "2026-09-03T02:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "虛構測試套房" })).toBeVisible();
    expect(screen.getByRole("link", { name: /返回歷史案件/u })).toHaveAttribute("href", "/history");
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect((await axe(container)).violations).toHaveLength(0);
  });
});
