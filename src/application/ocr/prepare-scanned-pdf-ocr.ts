import { assessOcrProviderOutput } from "@/domain/ocr";
import type {
  PrepareScannedPdfOcrInput,
  PrepareScannedPdfOcrResult,
  ScannedPdfOcrPort,
  ScannedPdfPreflightPort,
} from "./contracts";

export class PrepareScannedPdfOcr {
  constructor(
    private readonly preflight: ScannedPdfPreflightPort,
    private readonly ocr: ScannedPdfOcrPort,
  ) {}

  async execute(input: PrepareScannedPdfOcrInput): Promise<PrepareScannedPdfOcrResult> {
    const inspection = await this.preflight.inspect(input.bytes);
    const result = await this.ocr.recognize({ ...input, pageCount: inspection.pageCount });
    return {
      pageCount: inspection.pageCount,
      assessment: assessOcrProviderOutput(result.output, inspection.pageCount),
      provenance: result.provenance,
    };
  }
}
