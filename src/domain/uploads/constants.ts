export const UPLOAD_LIMITS = Object.freeze({
  filesPerRequest: 1,
  pdfBytes: 15 * 1024 * 1024,
  pdfPages: 30,
  pdfExtractedTextCharacters: 300_000,
  imageBytes: 25 * 1024 * 1024,
  imagePixels: 50_000_000,
  caseOriginalImageBytes: 400 * 1024 * 1024,
} as const);

export const UPLOAD_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "video/mp4",
] as const;
