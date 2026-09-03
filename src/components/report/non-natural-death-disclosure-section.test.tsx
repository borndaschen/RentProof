import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { evaluateNonNaturalDeathDisclosure } from "@/domain/non-natural-death-disclosure";
import { getGoldenReportViewModel } from "@/server/demo/golden-report-view-model";
import { NonNaturalDeathDisclosureSection } from "./non-natural-death-disclosure-section";

describe("NonNaturalDeathDisclosureSection", () => {
  it("shows two periods, neutral insufficiency, official source, and actions", async () => {
    const { container } = render(
      <NonNaturalDeathDisclosureSection report={getGoldenReportViewModel()} />,
    );
    expect(screen.getByRole("heading", { name: "專有部分非自然死亡揭露" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "出租人持有期間" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "出租人持有前且其知悉的期間" })).toBeVisible();
    expect(screen.getAllByText("資料不足")).toHaveLength(2);
    expect(screen.getByText(/取得雙方簽署/u)).toBeVisible();
    expect(screen.getByRole("link", { name: /內政部不動產資訊平台/u })).toHaveAttribute(
      "href",
      "https://pip.moi.gov.tw/Publicize/Info/G1020",
    );
    expect(container.textContent).not.toMatch(/是凶宅|不是凶宅|合法|違法|機率|黑名單/u);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("renders a server-supplied conflict and both controlled source links", () => {
    const report = getGoldenReportViewModel();
    const [first, second] = report.sources;
    if (first === undefined || second === undefined) throw new Error("report sources missing");
    const nonNaturalDeathDisclosure = evaluateNonNaturalDeathDisclosure({
      statements: [
        {
          statementId: "disclosure-conflict-yes-01",
          subjectScope: "exclusive_area",
          period: "during_owner_holding",
          answer: "yes",
          eventTypes: ["unspecified_non_natural_death"],
          sourceKind: "contract_clause",
          signedByProvider: false,
          locator: first.locator,
        },
        {
          statementId: "disclosure-conflict-no-001",
          subjectScope: "exclusive_area",
          period: "during_owner_holding",
          answer: "no",
          eventTypes: [],
          sourceKind: "landlord_written_statement",
          signedByProvider: false,
          locator: second.locator,
        },
      ],
    });
    render(<NonNaturalDeathDisclosureSection report={{ ...report, nonNaturalDeathDisclosure }} />);
    expect(screen.getByText("揭露內容互相不一致")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /查看來源/u })).toHaveLength(2);
  });
});
