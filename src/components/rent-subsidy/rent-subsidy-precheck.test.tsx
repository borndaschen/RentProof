import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { RentSubsidyPrecheck } from "./rent-subsidy-precheck";

const criteria = [
  ["application_window", "APPLICATION_DATE_UNKNOWN"],
  ["nationality_and_registration", "NATIONALITY_AND_REGISTRATION_UNKNOWN"],
  ["age_basis", "AGE_BASIS_UNKNOWN"],
  ["home_ownership", "HOME_OWNERSHIP_UNKNOWN"],
  ["income", "INCOME_UNKNOWN"],
  ["other_housing_assistance", "OTHER_ASSISTANCE_UNKNOWN"],
  ["lease_timing", "LEASE_TIMING_UNKNOWN"],
  ["building_basis", "BUILDING_BASIS_UNKNOWN"],
  ["named_leaseholder", "APPLICANT_LEASEHOLDER_STATE_UNKNOWN"],
  ["lease_genuineness", "LEASE_GENUINENESS_UNKNOWN"],
  ["landlord_relationship", "LANDLORD_RELATIONSHIP_UNKNOWN"],
  ["housing_program_type", "HOUSING_PROGRAM_TYPE_UNKNOWN"],
  ["monthly_rent_cap", "MONTHLY_RENT_UNKNOWN"],
  ["residential_use", "LEASE_USE_UNKNOWN"],
  ["care_institution", "CARE_INSTITUTION_STATE_UNKNOWN"],
] as const;

const validResult = {
  schema: "rentproof.rental-subsidy-precheck.v1",
  program: "115年度300億元中央擴大租金補貼",
  programYear: 115,
  rulesVersion: "115.2026-09-04.1",
  scope: "declared_applicant_and_rental_conditions_precheck",
  overallStatus: "insufficient_information",
  checks: criteria.map(([criterion, reasonCode], index) => ({
    criterion,
    status: "insufficient_information",
    reasonCode,
    officialQuestionReference: `問題${String(index + 1)}`,
    ...(criterion === "income"
      ? { thresholdTwd: 54_000 }
      : criterion === "monthly_rent_cap"
        ? { thresholdTwd: 39_000 }
        : {}),
  })),
  officialSources: [
    {
      sourceId: "MOI_115_CONDITIONS",
      title: "115年度申請條件",
      publisher: "內政部不動產資訊平台",
      url: "https://pip.moi.gov.tw/Publicize/Info/B1020?n=%E7%94%B3%E8%AB%8B%E6%A2%9D%E4%BB%B6&y=115",
      verifiedAt: "2026-09-04",
      snapshotSha256: "a".repeat(64),
    },
    {
      sourceId: "MOI_115_FAQ",
      title: "115年度常見問題",
      publisher: "內政部不動產資訊平台",
      url: "https://pip.moi.gov.tw/Publicize/Info/B1020?n=%E5%95%8F%E8%88%87%E7%AD%94&y=115",
      verifiedAt: "2026-09-04",
      snapshotSha256: "b".repeat(64),
    },
  ],
  officialDeterminationRequired: true,
  humanReviewRequired: true,
  sensitiveDocumentsRequested: false,
  disclaimerCode: "PRECHECK_NOT_OFFICIAL_ELIGIBILITY_DETERMINATION",
};

afterEach(() => vi.unstubAllGlobals());

describe("RentSubsidyPrecheck", () => {
  it("submits the exact domain input and renders all validated server checks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RentSubsidyPrecheck />);

    await user.selectOptions(screen.getByLabelText("租屋處縣市"), "臺北市");
    await user.click(screen.getByRole("button", { name: "查看預檢結果" }));

    expect(await screen.findByRole("heading", { name: "申請條件預檢結果" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "申請條件預檢結果" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("預檢完成：資料不足");
    expect(
      screen.getByRole("heading", { name: "申請條件預檢結果" }).closest("section"),
    ).toHaveAttribute("data-status", "insufficient_information");
    expect(screen.getByText("資料不足", { selector: "p" })).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(15);
    expect(
      screen.getByText("此次預檢採用的家庭成員平均每月所得門檻：低於 NT$ 54,000"),
    ).toBeVisible();
    expect(screen.getByText("此次預檢採用的每月租金上限：NT$ 39,000")).toBeVisible();
    expect(screen.getByRole("link", { name: "前往政府官方申請專區" })).toHaveAttribute(
      "href",
      "https://pip.moi.gov.tw/v3/B/SCRB0102.aspx",
    );
    expect(screen.getByRole("link", { name: "返回租屋資料整理" })).toHaveAttribute("href", "/");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.schemaVersion).toBe("rentproof.rent-subsidy-precheck-input.v1");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(body.input).toMatchObject({
      applicationDate: "unknown",
      rentalCountyCity: "臺北市",
      nationalityAndRegistration: "unknown",
      incomeComparedWithApplicableThreshold: "unknown",
      applicantIsNamedLeaseholder: "unknown",
      monthlyRentTwd: "unknown",
      is24HourCareInstitution: "unknown",
    });
    expect(Object.keys(body.input)).toHaveLength(17);

    await user.selectOptions(screen.getByLabelText("租屋處縣市"), "新北市");
    expect(screen.queryByRole("heading", { name: "申請條件預檢結果" })).not.toBeInTheDocument();
  });

  it("fails closed for a response outside the required display projection", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...validResult, checks: [] }), { status: 200 }),
        ),
    );
    const user = userEvent.setup();
    render(<RentSubsidyPrecheck />);
    await user.selectOptions(screen.getByLabelText("租屋處縣市"), "新北市");
    await user.click(screen.getByRole("button", { name: "查看預檢結果" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("沒有產生資格結論");
    expect(screen.getByRole("heading", { name: "預檢未完成" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "重新檢查" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "申請條件預檢結果" })).not.toBeInTheDocument();
  });

  it("explains a typed stale-source failure without presenting a result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "SUBSIDY_SOURCE_STALE" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const user = userEvent.setup();
    render(<RentSubsidyPrecheck />);
    await user.selectOptions(screen.getByLabelText("租屋處縣市"), "新北市");
    await user.click(screen.getByRole("button", { name: "查看預檢結果" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("官方資料待更新");
    expect(screen.queryByRole("heading", { name: "申請條件預檢結果" })).not.toBeInTheDocument();
  });

  it("offers an accessible retry after a temporary request failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("network unavailable"))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(validResult), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );
    const user = userEvent.setup();
    render(<RentSubsidyPrecheck />);
    await user.selectOptions(screen.getByLabelText("租屋處縣市"), "新北市");
    await user.click(screen.getByRole("button", { name: "查看預檢結果" }));
    await user.click(await screen.findByRole("button", { name: "重新檢查" }));

    expect(await screen.findByRole("heading", { name: "申請條件預檢結果" })).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    {
      officialSources: [
        { ...validResult.officialSources[0], url: "https://attacker.invalid/source" },
        validResult.officialSources[1],
      ],
    },
    {
      officialSources: [validResult.officialSources[0], validResult.officialSources[0]],
    },
    {
      officialSources: [
        {
          ...validResult.officialSources[0],
          url: "https://pip.moi.gov.tw/Publicize/Info/not-the-reviewed-source",
        },
        validResult.officialSources[1],
      ],
    },
    {
      checks: validResult.checks.map((check, index) =>
        index === 1 ? { ...check, criterion: "application_window" } : check,
      ),
    },
  ])("rejects unsafe or duplicate Server projection data %#", async (override) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...validResult, ...override }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const user = userEvent.setup();
    render(<RentSubsidyPrecheck />);
    await user.selectOptions(screen.getByLabelText("租屋處縣市"), "新北市");
    await user.click(screen.getByRole("button", { name: "查看預檢結果" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("沒有產生資格結論");
  });

  it("groups every criterion into eight questions and supports keyboard radio selection", async () => {
    const user = userEvent.setup();
    render(<RentSubsidyPrecheck />);
    expect(screen.getAllByText(/問題 [1-8]／8/u)).toHaveLength(8);
    expect(screen.getAllByRole("radio")).toHaveLength(15);
    const firstGroup = screen.getAllByRole("radio").slice(0, 3);
    firstGroup[0]?.focus();
    await user.keyboard("{ArrowRight}");
    expect(firstGroup[1]).toBeChecked();
  });

  it("shows privacy guidance and only neutral result language", () => {
    const { container } = render(<RentSubsidyPrecheck />);
    expect(screen.getByRole("heading", { name: "先保護你的資料" })).toBeVisible();
    expect(screen.getByText(/不需要姓名、身分證字號、詳細地址/u)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "結果怎麼看" })).not.toBeInTheDocument();
    expect(screen.queryByText("初步相符")).not.toBeInTheDocument();
    expect(screen.queryByText("有待確認")).not.toBeInTheDocument();
    expect(screen.queryByText("資料不足")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/保證符合|正式核准|合法|違法/u);
  });

  it("has no detectable component-level accessibility violations", async () => {
    const { container } = render(<RentSubsidyPrecheck />);
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
