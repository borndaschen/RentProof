import type { ImageInspection, PdfInspection } from "@/domain/uploads";

export interface ImageInspectionPort {
  inspect(bytes: Uint8Array): Promise<ImageInspection>;
}

export interface PdfInspectionPort {
  inspect(bytes: Uint8Array): Promise<PdfInspection>;
}
