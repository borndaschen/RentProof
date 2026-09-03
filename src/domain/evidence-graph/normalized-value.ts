import { z } from "zod";

export const NormalizedValueSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("money"),
      amountMinor: z.number().int().nonnegative(),
      currency: z.literal("TWD"),
      period: z.enum(["month", "one_time"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("unit_rate"),
      amountMinorPerUnit: z.number().int().nonnegative(),
      currency: z.literal("TWD"),
      unit: z.literal("kwh"),
    })
    .strict(),
  z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("text"), value: z.string().min(1).max(500) }).strict(),
]);

export type NormalizedValue = z.infer<typeof NormalizedValueSchema>;
