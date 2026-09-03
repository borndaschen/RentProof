import { describe, expect, it } from "vitest";
import { compareClaim } from "./claim-comparison";

describe("compareClaim", () => {
  it("treats an unshown washing machine as insufficient evidence", () => {
    expect(
      compareClaim([
        {
          coverage: "not_shown",
          locatorValid: true,
          quality: "sufficient",
          relation: "not_mentioned",
        },
      ]),
    ).toBe("insufficient_evidence");
  });

  it("requires explicit opposite evidence for contradiction", () => {
    expect(
      compareClaim([
        {
          coverage: "complete",
          locatorValid: true,
          quality: "sufficient",
          relation: "opposite",
        },
      ]),
    ).toBe("contradicted");
  });

  it("does not accept low-confidence or locator-free evidence", () => {
    expect(
      compareClaim([
        {
          coverage: "complete",
          locatorValid: false,
          quality: "low_confidence",
          relation: "same",
        },
      ]),
    ).toBe("insufficient_evidence");
  });
});
