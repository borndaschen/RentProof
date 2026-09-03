export const LISTING_URL_ERROR_CODES = [
  "INVALID_URL",
  "HOST_NOT_ALLOWED",
  "UNSAFE_ADDRESS",
  "UNSUPPORTED_PORT",
  "REDIRECT_LIMIT",
  "REDIRECT_HOST_NOT_ALLOWED",
  "FETCH_FAILED",
  "TIMEOUT",
  "UNSUPPORTED_MEDIA_TYPE",
  "RESPONSE_TOO_LARGE",
  "INVALID_ENCODING",
] as const;

export type ListingUrlErrorCode = (typeof LISTING_URL_ERROR_CODES)[number];

export class ListingUrlError extends Error {
  readonly code: ListingUrlErrorCode;
  constructor(code: ListingUrlErrorCode, message: string) {
    super(message);
    this.name = "ListingUrlError";
    this.code = code;
  }
}

export type ListingUrlLocator = { start: number; end: number; line: number };
export type ListingUrlText = { text: string; locator: ListingUrlLocator };
export type ListingUrlResult = { sourceUrl: string; text: string; segments: ListingUrlText[] };

export type ListingUrlFetcher = {
  fetch(url: string): Promise<{ sourceUrl: string; html: string }>;
};

export type ListingUrlService = { extract(url: string): Promise<ListingUrlResult> };
