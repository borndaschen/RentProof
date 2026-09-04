import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  SubsidySourceGovernanceError,
  normalizeSubsidySourceHtml,
} from "../src/domain/subsidy/source-governance.ts";

const SourceSchema = z
  .object({
    sourceId: z.string().regex(/^[A-Z][A-Z0-9_]+$/u),
    title: z.string().min(1),
    publisher: z.literal("內政部不動產資訊平台"),
    url: z.url().refine(isAllowedOfficialUrl),
    expectedFinalUrl: z.url().refine(isAllowedOfficialUrl),
    snapshotPath: z.string().regex(/^rules\/snapshots\/2026-09-04\/[a-z0-9-]+\.html$/u),
    contentType: z.literal("text/html"),
    bytes: z.number().int().positive().max(1_048_576),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    semanticSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    liveSemanticSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    semanticRegion: z.enum(["article", "homepage", "whole_document"]),
    semanticNormalizer: z.literal("rentproof.semantic-html.v2"),
    validation: z.array(z.string().min(1)).min(2),
  })
  .strict();

const ManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    snapshotDate: z.iso.date(),
    jurisdiction: z.literal("TW"),
    rulesetId: z.literal("rentproof-tw-rent-subsidy-precheck"),
    rulesVersion: z.literal("115.2026-09-04.1"),
    sources: z.array(SourceSchema).length(5),
  })
  .superRefine((manifest, context) => {
    if (
      new Set(manifest.sources.map((source) => source.sourceId)).size !== manifest.sources.length
    ) {
      context.addIssue({ code: "custom", message: "duplicate source id" });
    }
    if (
      new Set(manifest.sources.map((source) => source.snapshotPath.toLowerCase())).size !==
      manifest.sources.length
    ) {
      context.addIssue({ code: "custom", message: "duplicate snapshot path" });
    }
  })
  .strict();

const argumentsList = process.argv.slice(2);
if (argumentsList.length > 1 || (argumentsList.length === 1 && argumentsList[0] !== "--live")) {
  process.stderr.write("SUBSIDY_SOURCE_ARGUMENTS_INVALID\n");
  process.exitCode = 1;
}
const live = argumentsList[0] === "--live";
const manifestPath = resolve("rules/snapshots/2026-09-04/manifest.json");

if (process.exitCode === undefined)
  try {
    const manifestBytes = readFileSync(manifestPath);
    if (manifestBytes.byteLength > 1_048_576) throw new Error("SUBSIDY_SOURCE_MANIFEST_TOO_LARGE");
    const manifest = ManifestSchema.parse(JSON.parse(decodeUtf8(manifestBytes)) as unknown);
    assertFresh(manifest.snapshotDate, new Date());
    let localCount = 0;
    for (const source of manifest.sources) {
      const path = resolve(source.snapshotPath);
      assertPathInsideRoot(resolve("rules/snapshots/2026-09-04"), path);
      if (!existsSync(path)) continue;
      localCount += 1;
      verifyBytes(source, readFileSync(path));
    }
    if (live) {
      for (const source of manifest.sources) {
        const fetched = await fetchOfficialSource(source.url, source.sourceId);
        const { response } = fetched;
        if (fetched.finalUrl !== source.expectedFinalUrl) {
          throw new Error(`SUBSIDY_SOURCE_FINAL_URL_CHANGED:${source.sourceId}`);
        }
        if (!response.ok || response.status !== 200) throw new Error("SUBSIDY_SOURCE_HTTP_INVALID");
        if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
          throw new Error("SUBSIDY_SOURCE_CONTENT_TYPE_INVALID");
        }
        const bytes = await readBoundedResponse(response, 1_048_576);
        const text = decodeUtf8(bytes);
        verifySentinels(source, text);
        const semanticHash = sha256(Buffer.from(normalizeSourceHtml(source, text), "utf8"));
        if (semanticHash !== source.liveSemanticSha256) {
          throw new Error(`SUBSIDY_SOURCE_CHANGED:${source.sourceId}:${semanticHash}`);
        }
      }
    }
    process.stdout.write(
      `SUBSIDY_SOURCES_OK mode=${live ? "live" : "offline"} localSnapshots=${String(localCount)}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^SUBSIDY_SOURCE_[A-Z0-9_]+(?::[A-Z0-9_]+(?::[0-9a-f]{64})?)?$/u.test(message)
      ? message
      : "SUBSIDY_SOURCE_CHECK_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }

function assertFresh(snapshotDate: string, now: Date): void {
  const verifiedMs = Date.parse(`${snapshotDate}T00:00:00+08:00`);
  const nowMs = now.getTime();
  if (!Number.isFinite(verifiedMs) || !Number.isFinite(nowMs)) {
    throw new Error("SUBSIDY_SOURCE_DATE_INVALID");
  }
  const ageDays = (nowMs - verifiedMs) / 86_400_000;
  if (ageDays < 0) throw new Error("SUBSIDY_SOURCE_VERIFICATION_IN_FUTURE");
  if (ageDays > 31) throw new Error("SUBSIDY_SOURCE_STALE");
}

function verifyBytes(source: z.infer<typeof SourceSchema>, bytes: Uint8Array): void {
  if (bytes.byteLength !== source.bytes) {
    throw new Error(`SUBSIDY_SOURCE_BYTES_MISMATCH:${source.sourceId}`);
  }
  if (sha256(bytes) !== source.sha256) {
    throw new Error(`SUBSIDY_SOURCE_HASH_MISMATCH:${source.sourceId}`);
  }
  const text = decodeUtf8(bytes);
  verifySentinels(source, text);
  const semanticHash = sha256(Buffer.from(normalizeSourceHtml(source, text), "utf8"));
  if (semanticHash !== source.semanticSha256) {
    throw new Error(`SUBSIDY_SOURCE_SEMANTIC_HASH_MISMATCH:${source.sourceId}:${semanticHash}`);
  }
}

function verifySentinels(source: z.infer<typeof SourceSchema>, text: string): void {
  for (const entry of source.validation) {
    const separator = entry.indexOf(":");
    const operation = entry.slice(0, separator);
    const expected = entry.slice(separator + 1);
    if (!expected || (operation !== "contains" && operation !== "not-contains")) {
      throw new Error("SUBSIDY_SOURCE_SENTINEL_INVALID");
    }
    if (operation === "contains" && !text.includes(expected)) {
      throw new Error(`SUBSIDY_SOURCE_SENTINEL_MISSING:${source.sourceId}`);
    }
    if (operation === "not-contains" && text.includes(expected)) {
      throw new Error(`SUBSIDY_SOURCE_REJECTION_PAGE:${source.sourceId}`);
    }
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeSourceHtml(source: z.infer<typeof SourceSchema>, text: string): string {
  try {
    return normalizeSubsidySourceHtml(text, source.semanticRegion);
  } catch (error) {
    if (
      error instanceof SubsidySourceGovernanceError &&
      error.code === "SUBSIDY_SOURCE_SEMANTIC_BOUNDARY_INVALID"
    ) {
      throw new Error(`${error.code}:${source.sourceId}`);
    }
    throw error;
  }
}

function isAllowedOfficialUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname === "pip.moi.gov.tw" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
}

function assertPathInsideRoot(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot.length === 0 ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("SUBSIDY_SOURCE_SNAPSHOT_PATH_INVALID");
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("SUBSIDY_SOURCE_ENCODING_INVALID");
  }
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error("SUBSIDY_SOURCE_CONTENT_LENGTH_INVALID");
    }
    if (parsedLength > maximumBytes) throw new Error("SUBSIDY_SOURCE_TOO_LARGE");
  }
  if (response.body === null) throw new Error("SUBSIDY_SOURCE_BODY_MISSING");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maximumBytes) throw new Error("SUBSIDY_SOURCE_TOO_LARGE");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchOfficialSource(
  initialUrl: string,
  sourceId: string,
): Promise<{ response: Response; finalUrl: string }> {
  const maximumRedirects = 3;
  const signal = AbortSignal.timeout(30_000);
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        cache: "no-store",
        redirect: "manual",
        signal,
        headers: {
          accept: "text/html",
          "user-agent": "RentProof-Official-Source-Check/1.0",
        },
      });
    } catch {
      throw new Error(`SUBSIDY_SOURCE_FETCH_FAILED:${sourceId}`);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: currentUrl };
    }
    if (redirectCount === maximumRedirects) {
      await response.body?.cancel();
      throw new Error(`SUBSIDY_SOURCE_REDIRECT_LIMIT:${sourceId}`);
    }
    const location = response.headers.get("location");
    if (location === null) {
      await response.body?.cancel();
      throw new Error(`SUBSIDY_SOURCE_REDIRECT_INVALID:${sourceId}`);
    }
    let redirectedUrl: URL;
    try {
      redirectedUrl = new URL(location, currentUrl);
    } catch {
      await response.body?.cancel();
      throw new Error(`SUBSIDY_SOURCE_REDIRECT_INVALID:${sourceId}`);
    }
    if (!isAllowedOfficialUrl(redirectedUrl.toString())) {
      await response.body?.cancel();
      throw new Error(`SUBSIDY_SOURCE_REDIRECT_INVALID:${sourceId}`);
    }
    await response.body?.cancel();
    currentUrl = redirectedUrl.toString();
  }
  throw new Error(`SUBSIDY_SOURCE_REDIRECT_LIMIT:${sourceId}`);
}
