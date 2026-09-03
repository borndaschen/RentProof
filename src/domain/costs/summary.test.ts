import { describe, expect, it } from "vitest";
import { composeCostSummary } from "./summary";

const rent = {
  kind: "fixed_monthly",
  id: "rent",
  label: "月租",
  amount: { currency: "TWD", minorUnits: "12000" },
} as const;
const management = {
  kind: "fixed_monthly",
  id: "management",
  label: "固定管理費",
  amount: { currency: "TWD", minorUnits: "800" },
} as const;
const deposit = {
  kind: "one_time",
  id: "deposit",
  label: "押金",
  amount: { currency: "TWD", minorUnits: "24000" },
} as const;

describe("composeCostSummary", () => {
  it("sums only fixed monthly costs and keeps one-time costs separate", () => {
    const summary = composeCostSummary([rent, management, deposit]);

    expect(summary.fixedMonthly.total).toEqual({ currency: "TWD", minorUnits: "12800" });
    expect(summary.oneTime.total).toEqual({ currency: "TWD", minorUnits: "24000" });
    expect(summary.monthlyScenarioTotal).toEqual({
      status: "fixed_only",
      amount: { currency: "TWD", minorUnits: "12800" },
    });
  });

  it("retains the unit-rate formula and refuses to invent a monthly total without usage", () => {
    const summary = composeCostSummary([
      rent,
      {
        kind: "unit_rate",
        id: "electricity",
        label: "電費",
        rate: { currency: "TWD", minorUnitsPerUnit: "5", unit: "kwh" },
      },
      deposit,
    ]);

    expect(summary.variable).toEqual([
      {
        id: "electricity",
        label: "電費",
        formula: { minorUnitsPerUnit: "5", unit: "kwh" },
        scenario: { status: "usage_required" },
      },
    ]);
    expect(summary.monthlyScenarioTotal).toEqual({
      status: "usage_required",
      knownFixedAmount: { currency: "TWD", minorUnits: "12000" },
      missingUsageCostIds: ["electricity"],
    });
    expect(summary.oneTime.total.minorUnits).toBe("24000");
  });

  it("creates an explicitly estimated exact scenario only when all usage is present", () => {
    const summary = composeCostSummary([
      rent,
      {
        kind: "unit_rate",
        id: "electricity",
        label: "電費",
        rate: { currency: "TWD", minorUnitsPerUnit: "5.25", unit: "kwh" },
        usage: { quantity: "100.5", basis: "user_estimate" },
      },
    ]);

    expect(summary.variable[0]?.scenario).toEqual({
      status: "estimated",
      usage: { quantity: "100.5", basis: "user_estimate" },
      exactMinorUnits: "527.625",
    });
    expect(summary.monthlyScenarioTotal).toEqual({
      status: "estimated",
      currency: "TWD",
      exactMinorUnits: "12527.625",
    });
  });

  it("keeps the total unavailable when even one variable cost lacks usage", () => {
    const summary = composeCostSummary([
      rent,
      {
        kind: "unit_rate",
        id: "electricity",
        label: "電費",
        rate: { currency: "TWD", minorUnitsPerUnit: "5", unit: "kwh" },
        usage: { quantity: "100", basis: "user_estimate" },
      },
      {
        kind: "unit_rate",
        id: "water",
        label: "水費",
        rate: { currency: "TWD", minorUnitsPerUnit: "20", unit: "water_unit" },
      },
    ]);

    expect(summary.monthlyScenarioTotal).toMatchObject({
      status: "usage_required",
      missingUsageCostIds: ["water"],
    });
  });
});
