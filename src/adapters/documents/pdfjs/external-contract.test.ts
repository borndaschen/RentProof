import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractTextPdf } from "./extract-text";
import { pdfJsEngine } from "./pdfjs-engine";

const contractPath = join(
  process.env["RENTPROOF_DEMO_DIR"]?.trim() ||
    join(process.env["USERPROFILE"] ?? "", "RentProof-Demo"),
  "cases",
  "golden-v1",
  "contract",
  "synthetic-lease.pdf",
);

describe("external synthetic contract PDF", () => {
  it.skipIf(!existsSync(contractPath))(
    "extracts page-located text through the real PDF.js engine",
    async () => {
      const result = await extractTextPdf({
        bytes: await readFile(contractPath),
        engine: pdfJsEngine,
      });
      expect(result.pageCount).toBe(2);
      expect(result.characterCount).toBeGreaterThan(500);
      expect(result.pages[0]?.segments.length).toBeGreaterThan(0);
    },
    20_000,
  );
});
