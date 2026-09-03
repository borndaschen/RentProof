import { z } from "zod";

/** Canonical non-negative integer string; numbers never cross the money boundary. */
export const MinorUnitStringSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,17})$/u);

/** Canonical non-negative decimal with at most 18 integer and 6 fractional digits. */
export const DecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/u)
  .refine((value) => !value.includes(".") || !value.endsWith("0"), "Decimal must be canonical");

export const TwdMoneySchema = z
  .object({
    currency: z.literal("TWD"),
    minorUnits: MinorUnitStringSchema,
  })
  .strict();

export type MinorUnitString = z.infer<typeof MinorUnitStringSchema>;
export type DecimalString = z.infer<typeof DecimalStringSchema>;
export type TwdMoney = z.infer<typeof TwdMoneySchema>;

interface ParsedDecimal {
  coefficient: bigint;
  scale: number;
}

function parseDecimal(value: DecimalString): ParsedDecimal {
  const [whole, fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function formatDecimal(value: ParsedDecimal): DecimalString {
  if (value.coefficient === 0n) return "0";

  let digits = value.coefficient.toString();
  if (value.scale === 0) return DecimalStringSchema.parse(digits);
  digits = digits.padStart(value.scale + 1, "0");
  const split = digits.length - value.scale;
  const formatted = `${digits.slice(0, split)}.${digits.slice(split)}`.replace(/\.?0+$/u, "");
  return DecimalStringSchema.parse(formatted);
}

export function addDecimalStrings(values: readonly DecimalString[]): DecimalString {
  const parsed = values.map(parseDecimal);
  const scale = parsed.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const coefficient = parsed.reduce(
    (total, value) => total + value.coefficient * powerOfTen(scale - value.scale),
    0n,
  );
  return formatDecimal({ coefficient, scale });
}

export function multiplyDecimalStrings(left: DecimalString, right: DecimalString): DecimalString {
  const parsedLeft = parseDecimal(left);
  const parsedRight = parseDecimal(right);
  return formatDecimal({
    coefficient: parsedLeft.coefficient * parsedRight.coefficient,
    scale: parsedLeft.scale + parsedRight.scale,
  });
}

export function sumMinorUnits(values: readonly MinorUnitString[]): MinorUnitString {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
  return MinorUnitStringSchema.parse(total);
}

export function minorUnitsAsDecimal(value: MinorUnitString): DecimalString {
  return DecimalStringSchema.parse(value);
}
