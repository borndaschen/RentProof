import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { HistoryList } from "./history-list";

describe("HistoryList", () => {
  it("renders an accessible responsive owner-scoped list", async () => {
    const { container } = render(
      <HistoryList
        cases={[
          {
            caseId: "case_owned_by_a_00000001",
            displayName: "民生東路套房 A",
            status: "needs_attention",
            updatedAt: "2026-09-03T08:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "歷史租屋案件" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /民生東路套房 A/ })).toHaveAttribute(
      "href",
      "/history/case_owned_by_a_00000001",
    );
    expect(container).not.toHaveTextContent(/Demo|Fixture|Golden|P0|Synthetic|虛構/u);
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it("explains how to start when no case has been saved", () => {
    render(<HistoryList cases={[]} />);
    expect(screen.getByText(/建立新案件/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回" })).toHaveAttribute("href", "/");
  });

  it("labels every case state and safely encodes opaque case IDs in links", () => {
    render(
      <HistoryList
        cases={[
          {
            caseId: "case/draft",
            displayName: "草稿案件",
            status: "draft",
            updatedAt: "2026-09-03T00:00:00.000Z",
          },
          {
            caseId: "case analyzing",
            displayName: "分析案件",
            status: "analyzing",
            updatedAt: "2026-09-03T01:00:00.000Z",
          },
          {
            caseId: "case_attention",
            displayName: "確認案件",
            status: "needs_attention",
            updatedAt: "2026-09-03T02:00:00.000Z",
          },
          {
            caseId: "case_complete",
            displayName: "完成案件",
            status: "ready",
            updatedAt: "2026-09-03T03:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("準備資料中")).toBeVisible();
    expect(screen.getByText("正在整理")).toBeVisible();
    expect(screen.getByText("有項目待確認")).toBeVisible();
    expect(screen.getByText("可查看結果")).toBeVisible();
    expect(screen.getByRole("link", { name: /草稿案件/u })).toHaveAttribute(
      "href",
      "/history/case%2Fdraft",
    );
    expect(screen.getByRole("link", { name: /分析案件/u })).toHaveAttribute(
      "href",
      "/history/case%20analyzing",
    );
  });
});
