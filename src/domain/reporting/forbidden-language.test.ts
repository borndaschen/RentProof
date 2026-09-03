import { describe, expect, it } from "vitest";
import { ReportCompositionError, assertNeutralReportLanguage } from "./forbidden-language";

describe("assertNeutralReportLanguage", () => {
  it.each([
    "違法",
    "合法",
    "確定詐騙",
    "就是詐騙",
    "詐騙機率 90%",
    "安全分數",
    "安全無虞",
    "房東有責",
    "責任歸屬",
    "是凶宅",
    "不是凶宅",
    "凶宅機率 80%",
    "凶宅黑名單",
  ])("rejects forbidden verdict language: %s", (text) => {
    expect(() => assertNeutralReportLanguage({ nested: [text] })).toThrowError(
      new ReportCompositionError("REPORT_FORBIDDEN_LANGUAGE"),
    );
  });

  it("accepts neutral verification language and primitive metadata", () => {
    expect(() =>
      assertNeutralReportLanguage({ text: "請在付款前查證並補齊資料。", count: 3, optional: null }),
    ).not.toThrow();
  });
});
