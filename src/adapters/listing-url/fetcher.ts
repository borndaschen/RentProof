import dns from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { ListingUrlError, type ListingUrlFetcher } from "@/application/listing-url/contracts";

const MAX_BYTES = 1024 * 1024;

type PinnedResponse = Readonly<{
  status: number;
  location: string | null;
  mediaType: string | null;
  body: Uint8Array;
}>;

export type ListingUrlFetcherOptions = Readonly<{
  allowedHosts: readonly string[];
  timeoutMs?: number;
  resolve?: (host: string) => Promise<readonly string[]>;
  request?: (url: URL, pinnedAddress: string, timeoutMs: number) => Promise<PinnedResponse>;
}>;

export function createListingUrlFetcher(options: ListingUrlFetcherOptions): ListingUrlFetcher {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const resolve =
    options.resolve ??
    (async (host: string) =>
      (await dns.lookup(host, { all: true, verbatim: true })).map((entry) => entry.address));
  const request = options.request ?? requestPinned;
  const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));

  async function validate(raw: string, redirect: boolean): Promise<{ url: URL; address: string }> {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new ListingUrlError("INVALID_URL", "URL is invalid");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
      throw new ListingUrlError("INVALID_URL", "A public HTTPS URL is required");
    }
    if (parsed.port && parsed.port !== "443") {
      throw new ListingUrlError("UNSUPPORTED_PORT", "Only HTTPS port 443 is allowed");
    }
    const host = parsed.hostname.toLowerCase();
    if (!allowedHosts.has(host)) {
      throw new ListingUrlError(
        redirect ? "REDIRECT_HOST_NOT_ALLOWED" : "HOST_NOT_ALLOWED",
        "Host is not allowlisted",
      );
    }
    const addresses = await resolve(host);
    if (addresses.length === 0 || addresses.some(isUnsafeAddress)) {
      throw new ListingUrlError("UNSAFE_ADDRESS", "Host resolves to a prohibited address");
    }
    const address = addresses[0];
    if (!address) throw new ListingUrlError("UNSAFE_ADDRESS", "No public address resolved");
    return { url: parsed, address };
  }

  return {
    async fetch(initial) {
      let current = await validate(initial, false);
      for (let hop = 0; hop <= 2; hop += 1) {
        let response: PinnedResponse;
        try {
          response = await request(current.url, current.address, timeoutMs);
        } catch (error) {
          if (error instanceof ListingUrlError) throw error;
          throw new ListingUrlError("FETCH_FAILED", "Request failed");
        }
        if (response.status >= 300 && response.status < 400) {
          if (!response.location || hop === 2) {
            throw new ListingUrlError("REDIRECT_LIMIT", "Redirect limit exceeded");
          }
          current = await validate(new URL(response.location, current.url).toString(), true);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new ListingUrlError("FETCH_FAILED", "Remote page was unavailable");
        }
        if (response.mediaType?.toLowerCase().split(";", 1).at(0)?.trim() !== "text/html") {
          throw new ListingUrlError("UNSUPPORTED_MEDIA_TYPE", "Only text/html is accepted");
        }
        let html: string;
        try {
          html = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
        } catch {
          throw new ListingUrlError("INVALID_ENCODING", "Response is not valid UTF-8");
        }
        return { sourceUrl: current.url.toString(), html };
      }
      throw new ListingUrlError("REDIRECT_LIMIT", "Redirect limit exceeded");
    },
  };
}

function requestPinned(url: URL, address: string, timeoutMs: number): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: address,
        family: isIP(address),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.hostname,
        rejectUnauthorized: true,
        headers: { Host: url.host, Accept: "text/html", "User-Agent": "RentProof/0.1" },
      },
      (response) => {
        const declared = response.headers["content-length"];
        if (
          typeof declared === "string" &&
          /^\d+$/u.test(declared) &&
          Number(declared) > MAX_BYTES
        ) {
          response.destroy();
          reject(new ListingUrlError("RESPONSE_TOO_LARGE", "Response exceeds 1 MiB"));
          return;
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_BYTES) {
            response.destroy(new ListingUrlError("RESPONSE_TOO_LARGE", "Response exceeds 1 MiB"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 502,
            location:
              typeof response.headers.location === "string" ? response.headers.location : null,
            mediaType:
              typeof response.headers["content-type"] === "string"
                ? response.headers["content-type"]
                : null,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(new ListingUrlError("TIMEOUT", "Request timed out")),
    );
    request.once("socket", (socket) =>
      socket.once("connect", () => {
        const remote = socket.remoteAddress?.replace(/^::ffff:/u, "");
        const expected = address.replace(/^::ffff:/u, "");
        if (remote !== expected)
          request.destroy(new ListingUrlError("UNSAFE_ADDRESS", "Peer address changed"));
      }),
    );
    request.once("error", reject);
    request.end();
  });
}

function isUnsafeAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return true;
  if (version === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    if (mapped) return isUnsafeAddress(mapped);
    return (
      normalized === "::" ||
      normalized === "::1" ||
      /^(?:fc|fd|fe[89ab]|ff)/u.test(normalized) ||
      /^2001:db8:/u.test(normalized)
    );
  }
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return true;
  const first = octets[0];
  const second = octets[1];
  if (first === undefined || second === undefined) return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && [0, 168].includes(second)) ||
    (first === 198 && [18, 19, 51].includes(second)) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}
