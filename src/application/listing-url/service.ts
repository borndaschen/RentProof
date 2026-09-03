import {
  ListingUrlError,
  type ListingUrlFetcher,
  type ListingUrlResult,
  type ListingUrlService,
} from "./contracts";

const clean = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/[ \t\r]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();

export const createListingUrlService = (fetcher: ListingUrlFetcher): ListingUrlService => ({
  async extract(url: string): Promise<ListingUrlResult> {
    const fetched = await fetcher.fetch(url);
    const text = clean(fetched.html).normalize("NFC");
    const bounded = Array.from(text).slice(0, 100_000).join("");
    if (!bounded && text.length > 0)
      throw new ListingUrlError("INVALID_ENCODING", "Unable to normalize page text");
    const segments: ListingUrlResult["segments"][number][] = [];
    let offset = 0;
    for (const [index, line] of bounded.split("\n").entries()) {
      if (line.length > 0) {
        segments.push({
          text: line,
          locator: { start: offset, end: offset + line.length, line: index + 1 },
        });
      }
      offset += line.length + 1;
    }
    return { sourceUrl: fetched.sourceUrl, text: bounded, segments };
  },
});
