import { describe, expect, it } from "vitest";
import { buildScannedPdfOcrRequest } from "./request-builder";

const input = {
  caseId: "case_00000000000000000000",
  artifactId: "artifact_000000000000000",
  pageCount: 1,
  bytes: new TextEncoder().encode("%PDF-synthetic"),
};

describe("buildScannedPdfOcrRequest", () => {
  it("uses inline file data, fixed Terra routing, no tools, and no storage", () => {
    const request = buildScannedPdfOcrRequest(input);
    expect(request).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning: { effort: "medium" },
      service_tier: "default",
      store: false,
      tools: [],
      truncation: "disabled",
    });
    const message = request.input[0];
    expect(message).toMatchObject({ role: "user" });
    if (typeof message !== "object" || message === null || !("content" in message)) {
      throw new Error("expected input message");
    }
    expect(message.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "input_file",
          detail: "high",
          filename: "scanned-contract.pdf",
          file_data: Buffer.from(input.bytes).toString("base64"),
        }),
      ]),
    );
    expect(JSON.stringify(request)).not.toContain("file_url");
  });
});
