import { z } from "zod";
import { DecimalStringSchema, TwdMoneySchema } from "./money";

const CostIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const CostLabelSchema = z.string().trim().min(1).max(120);

export const FixedMonthlyCostSchema = z
  .object({
    kind: z.literal("fixed_monthly"),
    id: CostIdSchema,
    label: CostLabelSchema,
    amount: TwdMoneySchema,
  })
  .strict();

export const UnitRateCostSchema = z
  .object({
    kind: z.literal("unit_rate"),
    id: CostIdSchema,
    label: CostLabelSchema,
    rate: z
      .object({
        currency: z.literal("TWD"),
        minorUnitsPerUnit: DecimalStringSchema,
        unit: z.enum(["kwh", "water_unit", "day", "use", "other"]),
      })
      .strict(),
    usage: z
      .object({
        quantity: DecimalStringSchema,
        basis: z.enum(["user_estimate", "meter_reading", "contract_allowance"]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const OneTimeCostSchema = z
  .object({
    kind: z.literal("one_time"),
    id: CostIdSchema,
    label: CostLabelSchema,
    amount: TwdMoneySchema,
  })
  .strict();

export const CostValueSchema = z.discriminatedUnion("kind", [
  FixedMonthlyCostSchema,
  UnitRateCostSchema,
  OneTimeCostSchema,
]);

export const CostCollectionSchema = z.array(CostValueSchema).superRefine((costs, context) => {
  const ids = new Set<string>();
  for (const [index, cost] of costs.entries()) {
    if (ids.has(cost.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate cost id: ${cost.id}`,
        path: [index, "id"],
      });
    }
    ids.add(cost.id);
  }
});

export type FixedMonthlyCost = z.infer<typeof FixedMonthlyCostSchema>;
export type UnitRateCost = z.infer<typeof UnitRateCostSchema>;
export type OneTimeCost = z.infer<typeof OneTimeCostSchema>;
export type CostValue = z.infer<typeof CostValueSchema>;
