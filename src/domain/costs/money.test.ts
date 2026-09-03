import { describe, expect, it } from "vitest";
import {
  DecimalStringSchema,
  MinorUnitStringSchema,
  addDecimalStrings,
  multiplyDecimalStrings,
  sumMinorUnits,
} from "./money";

describe("safe money strings", () => {
  it.each(["0", "1", "12000", "999999999999999999"])(
    "accepts canonical minor units %s",
    (value) => {
      expect(MinorUnitStringSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(["-1", "+1", "01", "1.0", "1e3", "9007199254740991000", "Infinity", "NaN"])(
    "rejects unsafe minor units %s",
    (value) => {
      expect(MinorUnitStringSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(["0", "5", "5.25", "0.125", "999999999999999999.123456"])(
    "accepts canonical decimal %s",
    (value) => {
      expect(DecimalStringSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(["01", ".5", "1.", "1.20", "1.1234567", "-0.5", "1e2"])(
    "rejects non-canonical or unsafe decimal %s",
    (value) => {
      expect(DecimalStringSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("exact decimal arithmetic", () => {
  it("sums minor units with bigint rather than Number", () => {
    expect(sumMinorUnits(["9007199254740991", "9"])).toBe("9007199254741000");
  });

  it("multiplies and adds decimal strings without floating-point drift", () => {
    expect(multiplyDecimalStrings("5.25", "100.5")).toBe("527.625");
    expect(addDecimalStrings(["12000", "527.625", "0.375"])).toBe("12528");
  });
});
