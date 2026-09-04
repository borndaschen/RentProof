import type { TaiwanCountyCity } from "./schema";

type Thresholds = Readonly<{ standardIncome: number; enhancedIncome: number; monthlyRent: number }>;

const STANDARD_DEFAULT = 46_545;
const ENHANCED_DEFAULT = 54_303;
const RENT_DEFAULT = 39_000;

const overrides: Partial<Record<TaiwanCountyCity, Thresholds>> = {
  臺北市: { standardIncome: 61_137, enhancedIncome: 71_327, monthlyRent: 55_000 },
  新北市: { standardIncome: 50_700, enhancedIncome: 59_150, monthlyRent: 45_000 },
  桃園市: { standardIncome: 50_304, enhancedIncome: 58_688, monthlyRent: 45_000 },
  臺中市: { standardIncome: 48_231, enhancedIncome: 56_270, monthlyRent: 45_000 },
  臺南市: { standardIncome: 46_545, enhancedIncome: 54_303, monthlyRent: 40_000 },
  高雄市: { standardIncome: 48_120, enhancedIncome: 56_140, monthlyRent: 40_000 },
  新竹市: {
    standardIncome: STANDARD_DEFAULT,
    enhancedIncome: ENHANCED_DEFAULT,
    monthlyRent: 45_000,
  },
  新竹縣: {
    standardIncome: STANDARD_DEFAULT,
    enhancedIncome: ENHANCED_DEFAULT,
    monthlyRent: 45_000,
  },
  金門縣: { standardIncome: 43_023, enhancedIncome: 50_194, monthlyRent: RENT_DEFAULT },
  連江縣: { standardIncome: 43_023, enhancedIncome: 50_194, monthlyRent: RENT_DEFAULT },
};

export function subsidyThresholdsFor115(countyCity: TaiwanCountyCity): Thresholds {
  return (
    overrides[countyCity] ?? {
      standardIncome: STANDARD_DEFAULT,
      enhancedIncome: ENHANCED_DEFAULT,
      monthlyRent: RENT_DEFAULT,
    }
  );
}
