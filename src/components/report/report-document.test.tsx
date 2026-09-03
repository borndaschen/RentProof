import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { evaluateNonNaturalDeathDisclosure } from "@/domain/non-natural-death-disclosure";
import { getGoldenReportViewModel } from "@/server/demo/golden-report-view-model";
import { ReportDocument } from "./report-document";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReportDocument", () => {
  it("renders the synthetic report with neutral statuses and three deterministic actions", () => {
    render(<ReportDocument report={getGoldenReportViewModel()} />);

    expect(screen.getByRole("heading", { level: 1, name: "簽約前確認報告" })).toBeVisible();
    expect(screen.getByText("這不是法律意見，也不是詐騙判決。")).toBeVisible();
    expect(screen.getByText(/資料完全虛構/u)).toBeVisible();
    expect(screen.getByRole("heading", { name: "支持" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "矛盾" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "證據不足" })).toBeVisible();
    expect(screen.getAllByText("未發現差異")).toHaveLength(1);
    expect(screen.getAllByText("疑似差異")).toHaveLength(2);
    expect(screen.getAllByText("資料不足")).toHaveLength(8);
    for (const ruleId of ["RP-003", "RP-004", "RP-006", "RP-008", "RP-009", "RP-010"]) {
      expect(screen.getByRole("rowheader", { name: new RegExp(`^${ruleId}`, "u") })).toBeVisible();
    }
    expect(screen.getByRole("heading", { name: "付款前先停下並核對" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "專有部分非自然死亡揭露" })).toBeVisible();
    expect(screen.getAllByText("尚無可採用的明確勾選")).toHaveLength(2);

    const actionSection = screen
      .getByRole("heading", { name: "3 項優先確認行動" })
      .closest("section");
    if (actionSection === null) throw new Error("action section missing");
    expect(actionSection.querySelectorAll(".report-action-list > li")).toHaveLength(3);
    expect(within(actionSection).getByText("付款前查證")).toBeVisible();
    expect(within(actionSection).getByText("詢問並留下書面紀錄")).toBeVisible();
    expect(within(actionSection).getByText("修改契約或確認內容")).toBeVisible();
    expect(within(actionSection).getByText(/另有 6 項補件事項/u)).toBeVisible();
  });

  it("renders all ten server-selected P1 rules with names, official links, and typed actions", () => {
    const report = getGoldenReportViewModel("p1");
    render(<ReportDocument report={report} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(10);
    for (const [ruleId, title] of [
      ["RP-001", "契約審閱期"],
      ["RP-002", "廣告承諾不得整體排除"],
      ["RP-005", "押金上限與返還"],
      ["RP-007", "非按度計費與公共用電"],
    ] as const) {
      const row = screen
        .getByRole("rowheader", { name: new RegExp(`^${ruleId}`, "u") })
        .closest("tr");
      if (row === null) throw new Error("P1 rule row missing");
      expect(within(row).getByText(title)).toBeVisible();
      expect(within(row).getByRole("link")).toHaveAttribute(
        "href",
        expect.stringMatching(/^https:\/\//u),
      );
      expect(within(row).getByText("補入附件或文件")).toBeVisible();
    }
    expect(report.actions.filter((action) => action.target.kind === "rule_check")).toHaveLength(10);
  });

  it("keeps fixed, variable, and one-time costs visibly separate", () => {
    render(<ReportDocument report={getGoldenReportViewModel()} />);
    expect(screen.getByRole("heading", { name: "固定月費" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "依使用量變動" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "一次性費用" })).toBeVisible();
    expect(screen.getAllByText("NT$ 12,000")).toHaveLength(2);
    expect(screen.getByText("5 元／度 × 實際用量")).toBeVisible();
    expect(screen.getByText(/不產生單一完整月總額/u)).toBeVisible();
    expect(screen.getAllByText("NT$ 24,000")).toHaveLength(2);
  });

  it("links evidence only through the controlled demo artifact endpoint", () => {
    render(<ReportDocument report={getGoldenReportViewModel()} />);
    const evidenceLinks = screen.getAllByRole("link", { name: /查看來源/u });
    const manifestVisibleArtifactIds = new Set([
      "listing-synthetic-listing-png",
      "contract-synthetic-lease-pdf",
      "follow-up-wall-close-up-png",
    ]);
    expect(evidenceLinks.length).toBeGreaterThan(0);
    for (const link of evidenceLinks) {
      const href = link.getAttribute("href");
      expect(href).toMatch(/^\/api\/demo\/golden-v1\/artifacts\/[a-z0-9-]+$/u);
      expect(manifestVisibleArtifactIds.has(href?.split("/").at(-1) ?? "")).toBe(true);
    }
    expect(screen.getAllByText(/locator-payment-000001（不公開預覽）/u).length).toBeGreaterThan(0);
  });

  it("shows snapshot and manifest provenance without truth or fallback content", () => {
    const report = getGoldenReportViewModel();
    render(<ReportDocument report={report} />);
    expect(screen.getByText(/snapshot-golden-000001/u)).toBeVisible();
    expect(screen.getByText(/golden-v1/u)).toBeVisible();
    expect(screen.getByText(/f3797356a1e3ea4/u)).toBeVisible();
    expect(JSON.stringify(report)).not.toMatch(/truth|fallback/iu);
  });

  it("prints located yes/no disclosure data from the report without client-side evaluation", () => {
    const report = getGoldenReportViewModel();
    const contract = report.sources.find((source) => source.refId === "locator-contract-00001");
    const listing = report.sources.find((source) => source.refId === "locator-listing-000001");
    if (contract === undefined || listing === undefined) throw new Error("report sources missing");
    const nonNaturalDeathDisclosure = evaluateNonNaturalDeathDisclosure({
      statements: [
        {
          statementId: "disclosure-owner-period-yes",
          subjectScope: "exclusive_area",
          period: "during_owner_holding",
          answer: "yes",
          eventTypes: ["other_non_natural_death"],
          sourceKind: "contract_clause",
          signedByProvider: false,
          locator: contract.locator,
        },
        {
          statementId: "disclosure-known-before-no",
          subjectScope: "exclusive_area",
          period: "before_owner_holding_known",
          answer: "no",
          eventTypes: [],
          sourceKind: "landlord_written_statement",
          signedByProvider: false,
          locator: listing.locator,
        },
      ],
    });
    render(<ReportDocument report={{ ...report, nonNaturalDeathDisclosure }} />);
    expect(screen.getByText("文件明確勾選：是")).toBeVisible();
    expect(screen.getByText("文件明確勾選：否")).toBeVisible();
    const disclosureSection = screen
      .getByRole("heading", { name: "專有部分非自然死亡揭露" })
      .closest("section");
    if (disclosureSection === null) throw new Error("disclosure section missing");
    expect(within(disclosureSection).getAllByRole("link", { name: /查看來源/u })).toHaveLength(2);
  });

  it("invokes the browser print dialog from the client-only button", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<ReportDocument report={getGoldenReportViewModel()} />);
    await user.click(screen.getByRole("button", { name: "列印或另存 PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("contains no forbidden verdict language and has no detectable axe violations", async () => {
    const { container } = render(<ReportDocument report={getGoldenReportViewModel()} />);
    expect(container.textContent).not.toMatch(
      /違法|合法|確定詐騙|就是詐騙|詐騙機率|安全分數|安全無虞|房東有責|責任歸屬|是凶宅|不是凶宅/u,
    );
    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
