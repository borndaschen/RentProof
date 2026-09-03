import type { CostValue, UnitRateCost } from "./cost";
import { CostCollectionSchema } from "./cost";
import {
  addDecimalStrings,
  minorUnitsAsDecimal,
  multiplyDecimalStrings,
  sumMinorUnits,
  type DecimalString,
  type TwdMoney,
} from "./money";

export interface UnitRateCostSummary {
  id: string;
  label: string;
  formula: {
    minorUnitsPerUnit: DecimalString;
    unit: UnitRateCost["rate"]["unit"];
  };
  scenario:
    | { status: "usage_required" }
    | {
        status: "estimated";
        usage: NonNullable<UnitRateCost["usage"]>;
        exactMinorUnits: DecimalString;
      };
}

export type MonthlyScenarioTotal =
  | {
      status: "fixed_only";
      amount: TwdMoney;
    }
  | {
      status: "usage_required";
      knownFixedAmount: TwdMoney;
      missingUsageCostIds: string[];
    }
  | {
      status: "estimated";
      currency: "TWD";
      exactMinorUnits: DecimalString;
    };

export interface CostSummary {
  fixedMonthly: {
    items: Extract<CostValue, { kind: "fixed_monthly" }>[];
    total: TwdMoney;
  };
  variable: UnitRateCostSummary[];
  oneTime: {
    items: Extract<CostValue, { kind: "one_time" }>[];
    total: TwdMoney;
  };
  monthlyScenarioTotal: MonthlyScenarioTotal;
}

function summarizeUnitRate(cost: UnitRateCost): UnitRateCostSummary {
  const formula = {
    minorUnitsPerUnit: cost.rate.minorUnitsPerUnit,
    unit: cost.rate.unit,
  };
  if (cost.usage === undefined) {
    return { id: cost.id, label: cost.label, formula, scenario: { status: "usage_required" } };
  }
  return {
    id: cost.id,
    label: cost.label,
    formula,
    scenario: {
      status: "estimated",
      usage: cost.usage,
      exactMinorUnits: multiplyDecimalStrings(cost.rate.minorUnitsPerUnit, cost.usage.quantity),
    },
  };
}

export function composeCostSummary(input: unknown): CostSummary {
  const costs = CostCollectionSchema.parse(input);
  const fixedItems = costs.filter((cost) => cost.kind === "fixed_monthly");
  const variable = costs.filter((cost) => cost.kind === "unit_rate").map(summarizeUnitRate);
  const oneTimeItems = costs.filter((cost) => cost.kind === "one_time");
  const fixedTotal: TwdMoney = {
    currency: "TWD",
    minorUnits: sumMinorUnits(fixedItems.map((cost) => cost.amount.minorUnits)),
  };
  const oneTimeTotal: TwdMoney = {
    currency: "TWD",
    minorUnits: sumMinorUnits(oneTimeItems.map((cost) => cost.amount.minorUnits)),
  };

  const missingUsageCostIds = variable
    .filter((cost) => cost.scenario.status === "usage_required")
    .map((cost) => cost.id);
  let monthlyScenarioTotal: MonthlyScenarioTotal;
  if (variable.length === 0) {
    monthlyScenarioTotal = { status: "fixed_only", amount: fixedTotal };
  } else if (missingUsageCostIds.length > 0) {
    monthlyScenarioTotal = {
      status: "usage_required",
      knownFixedAmount: fixedTotal,
      missingUsageCostIds,
    };
  } else {
    const variableAmounts = variable.flatMap((cost) =>
      cost.scenario.status === "estimated" ? [cost.scenario.exactMinorUnits] : [],
    );
    monthlyScenarioTotal = {
      status: "estimated",
      currency: "TWD",
      exactMinorUnits: addDecimalStrings([
        minorUnitsAsDecimal(fixedTotal.minorUnits),
        ...variableAmounts,
      ]),
    };
  }

  return {
    fixedMonthly: { items: fixedItems, total: fixedTotal },
    variable,
    oneTime: { items: oneTimeItems, total: oneTimeTotal },
    monthlyScenarioTotal,
  };
}
