import { describe, expect, it } from "vitest";
import { CostCollectionSchema, CostValueSchema } from "./cost";

describe("CostValueSchema", () => {
  it.each([
    {
      kind: "fixed_monthly",
      id: "rent",
      label: "月租",
      amount: { currency: "TWD", minorUnits: "12000" },
    },
    {
      kind: "unit_rate",
      id: "electricity",
      label: "電費",
      rate: { currency: "TWD", minorUnitsPerUnit: "5", unit: "kwh" },
    },
    {
      kind: "one_time",
      id: "deposit",
      label: "押金",
      amount: { currency: "TWD", minorUnits: "24000" },
    },
  ])("accepts the $kind discriminated value", (value) => {
    expect(CostValueSchema.safeParse(value).success).toBe(true);
  });

  it("rejects unknown keys, numeric money, and duplicate ids", () => {
    expect(
      CostValueSchema.safeParse({
        kind: "fixed_monthly",
        id: "rent",
        label: "月租",
        amount: { currency: "TWD", minorUnits: 12000 },
      }).success,
    ).toBe(false);
    expect(
      CostValueSchema.safeParse({
        kind: "one_time",
        id: "deposit",
        label: "押金",
        amount: { currency: "TWD", minorUnits: "24000" },
        extra: true,
      }).success,
    ).toBe(false);

    const cost = {
      kind: "fixed_monthly",
      id: "rent",
      label: "月租",
      amount: { currency: "TWD", minorUnits: "12000" },
    };
    expect(CostCollectionSchema.safeParse([cost, cost]).success).toBe(false);
  });
});
