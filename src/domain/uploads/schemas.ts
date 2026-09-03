import { z } from "zod";
import { UPLOAD_ALLOWED_MIME_TYPES } from "./constants";

export const UploadKindSchema = z.enum([
  "listing_image",
  "viewing_image",
  "follow_up_image",
  "interaction_image",
  "contract_pdf",
]);

export const UploadMimeTypeSchema = z.enum(UPLOAD_ALLOWED_MIME_TYPES);
export const UploadSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/u;

export function isSafeUploadDisplayFilename(filename: string): boolean {
  const codePoints = [...filename].length;
  return (
    codePoints >= 1 &&
    codePoints <= 255 &&
    filename === filename.normalize("NFC") &&
    filename === filename.trim() &&
    !filename.endsWith(".") &&
    !INVALID_FILENAME_CHARACTERS.test(filename) &&
    !WINDOWS_RESERVED_NAME.test(filename)
  );
}

export const UploadFileMetadataSchema = z
  .object({
    filename: z.string().refine(isSafeUploadDisplayFilename, "UPLOAD_FILENAME_INVALID"),
    declaredMime: UploadMimeTypeSchema,
    kind: UploadKindSchema,
    expectedSha256: UploadSha256Schema.optional(),
  })
  .strict();

export const ImageInspectionSchema = z
  .object({
    format: z.enum(["jpeg", "png"]),
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
    pageCount: z.literal(1),
    animated: z.literal(false),
  })
  .strict();

export const PdfInspectionSchema = z
  .object({
    pageCount: z.number().int().positive().safe(),
    extractedTextCharacters: z.number().int().nonnegative().safe(),
    textLocatorsAvailable: z.boolean(),
    encrypted: z.boolean(),
    hasJavaScript: z.boolean(),
    attachmentCount: z.number().int().nonnegative().safe(),
    hasFormActions: z.boolean(),
    hasExternalLinks: z.boolean(),
  })
  .strict();

export type UploadKind = z.infer<typeof UploadKindSchema>;
export type UploadMimeType = z.infer<typeof UploadMimeTypeSchema>;
export type UploadFileMetadata = z.infer<typeof UploadFileMetadataSchema>;
export type ImageInspection = z.infer<typeof ImageInspectionSchema>;
export type PdfInspection = z.infer<typeof PdfInspectionSchema>;
