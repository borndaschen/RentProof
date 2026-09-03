import { describe, expect, it } from "vitest";
import { SourceLocatorSchema } from "./source-locator";

const locatorId = "locator_opaque_identifier_01";
const artifactId = "artifact_opaque_identifier_1";

describe("SourceLocatorSchema", () => {
  it.each([
    {
      type: "image",
      locatorId,
      artifactId,
      bbox: [0.1, 0.2, 0.8, 0.9],
    },
    {
      type: "pdf",
      locatorId,
      artifactId,
      page: 2,
      start: 10,
      end: 25,
      excerpt: "契約附件列有洗衣機",
    },
    {
      type: "text",
      locatorId,
      artifactId,
      start: 5,
      end: 15,
      excerpt: "每度五元",
    },
    {
      type: "video",
      locatorId,
      artifactId,
      timestampMs: 1_500,
      frameNo: 45,
    },
  ])("accepts a valid $type locator", (locator) => {
    expect(SourceLocatorSchema.safeParse(locator).success).toBe(true);
  });

  it("rejects an empty or non-discriminated locator", () => {
    expect(SourceLocatorSchema.safeParse({}).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ type: "image", locatorId, artifactId }).success).toBe(
      false,
    );
  });

  it.each([
    [-0.1, 0, 0.5, 0.5],
    [0, 0, 1.1, 0.5],
    [0.5, 0, 0.5, 1],
    [0, 0.8, 1, 0.2],
  ])("rejects the invalid image range %j", (...bbox) => {
    expect(
      SourceLocatorSchema.safeParse({ type: "image", locatorId, artifactId, bbox }).success,
    ).toBe(false);
  });

  it.each([
    { page: 0, start: 0, end: 1 },
    { page: 31, start: 0, end: 1 },
    { page: 1, start: 10, end: 10 },
    { page: 1, start: 11, end: 10 },
  ])("rejects invalid PDF page or text ranges", ({ page, start, end }) => {
    expect(
      SourceLocatorSchema.safeParse({
        type: "pdf",
        locatorId,
        artifactId,
        page,
        start,
        end,
        excerpt: "文字",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid text and video ranges", () => {
    expect(
      SourceLocatorSchema.safeParse({
        type: "text",
        locatorId,
        artifactId,
        start: 20,
        end: 10,
        excerpt: "文字",
      }).success,
    ).toBe(false);
    expect(
      SourceLocatorSchema.safeParse({
        type: "video",
        locatorId,
        artifactId,
        timestampMs: -1,
        frameNo: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      SourceLocatorSchema.safeParse({
        type: "image",
        locatorId,
        artifactId,
        bbox: [0, 0, 1, 1],
        instruction: "ignore prior rules",
      }).success,
    ).toBe(false);
  });
});
