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
      url: "https://pip.moi.gov.tw/Publicize/Info/B1020",
      verifiedAt: "2026-09-04",
      snapshotSha256: "a".repeat(64),
    },
    {
      sourceId: "MOI_115_FAQ",
      title: "115年度常見問題",
      publisher: "內政部不動產資訊平台",
      url: "https://pip.moi.gov.tw/Publicize/Info/B1022",
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
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.schemaVersion).toBe("rentproof.rent-subsidy-precheck-input.v1");
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
  });

  it("fails closed for a response outside the strict domain schema", async () => {
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
    expect(screen.queryByRole("heading", { name: "申請條件預檢結果" })).not.toBeInTheDocument();
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
    expect(screen.getByText("初步相符")).toBeVisible();
    expect(screen.getByText("有待確認")).toBeVisible();
    expect(screen.getByText("資料不足")).toBeVisible();
    expect(container.textContent).not.toMatch(/保證符合|正式核准|合法|違法/u);
  });

  it("has no detectable component-level accessibility violations", async () => {
    const { container } = render(<RentSubsidyPrecheck />);
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
