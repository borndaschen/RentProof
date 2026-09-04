export const VIDEO_LIMITS = Object.freeze({
  maxBytes: 50 * 1024 * 1024,
  maxDurationMs: 30_000,
  maxPixelsPerFrame: 8_294_400,
  maxFrameRate: 60,
  frameIntervalMs: 2_000,
  maxExtractedFrames: 15,
  maxFrameBytes: 5 * 1024 * 1024,
  derivativeMaxLongEdge: 3_200,
} as const);

export const VIDEO_MIME_TYPE = "video/mp4" as const;
