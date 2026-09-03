import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

const caseRoot = resolve(process.argv[2] ?? "");
if (!process.argv[2] || basename(caseRoot) !== "golden-v1")
  throw new Error("GOLDEN_V1_ROOT_REQUIRED");
const manifestPath = join(caseRoot, "manifest.json");
try {
  await stat(manifestPath);
  throw new Error("SEALED_DEMO_VERSION_IMMUTABLE");
} catch (error) {
  if (error instanceof Error && error.message === "SEALED_DEMO_VERSION_IMMUTABLE") throw error;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
async function writeNew(relativePath, value) {
  const target = join(caseRoot, ...relativePath.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, json(value), { encoding: "utf8", flag: "wx" });
}

await writeNew("interaction/payment-request.json", {
  schema: "rentproof.synthetic-interaction.v1",
  synthetic: true,
  firstInPersonViewingAt: "2026-09-05T14:00:00+08:00",
  paymentRequestedAt: "2026-09-04T20:00:00+08:00",
  paymentType: "reservation_deposit",
  amountTwd: "3000",
  text: "虛構出租方表示：若要保留看屋順位，請在明天下午看屋前先付新臺幣 3,000 元。此句為防詐測試資料，沒有帳號、連結或 QR code。",
});

await writeNew("truth/assertions.json", {
  schema: "rentproof.golden-truth.v1",
  synthetic: true,
  claims: [
    { id: "claim-rent", expected: "supported", value: { amountTwd: "12000", cadence: "monthly" } },
    {
      id: "claim-washing-machine",
      expected: "insufficient_evidence",
      reason: "not_shown_and_not_listed_is_not_opposite_evidence",
    },
    {
      id: "claim-electricity-rate",
      expected: "contradicted",
      listingRateTwdPerKwh: "5",
      contractRateTwdPerKwh: "6",
    },
    {
      id: "claim-rent-subsidy",
      expected: "contradicted",
      listingAllows: true,
      contractRestricts: true,
    },
  ],
  observation: {
    id: "observation-wall-mark",
    expected: "follow_up_required",
    forbiddenConclusions: ["leak", "structural_damage", "liability"],
    requiredAction: "photograph_wall_ceiling_and_adjacent_surface_and_ask_for_repair_history",
  },
  fraudSignal: {
    id: "FRS-001",
    expected: "signal_present",
    reason: "payment_requested_before_first_in_person_viewing",
    forbiddenOutputs: ["fraud_verdict", "fraud_probability", "safety_score"],
  },
  ruleChecks: [
    { ruleId: "RP-003", expected: "missing_information" },
    { ruleId: "RP-004", expected: "missing_information" },
    { ruleId: "RP-006", expected: "missing_information" },
    { ruleId: "RP-008", expected: "missing_information" },
    { ruleId: "RP-009", expected: "missing_information" },
    { ruleId: "RP-010", expected: "possible_difference" },
  ],
});

await writeNew("fallback/analysis.json", {
  schema: "rentproof.fixture-analysis.v1",
  synthetic: true,
  provenance: {
    mode: "fixture",
    caseVersion: "golden-v1",
    requestedServiceTier: "default",
    resolvedServiceTier: "fixture_no_provider_call",
  },
  findings: [
    {
      claimId: "claim-rent",
      status: "supported",
      sourceRefs: ["listing:price", "contract:page-1:rent"],
    },
    {
      claimId: "claim-washing-machine",
      status: "insufficient_evidence",
      sourceRefs: ["listing:equipment", "viewing:view-10", "contract:page-2:equipment"],
    },
    {
      claimId: "claim-electricity-rate",
      status: "contradicted",
      sourceRefs: ["listing:electricity", "contract:page-1:electricity"],
    },
    {
      claimId: "claim-rent-subsidy",
      status: "contradicted",
      sourceRefs: ["listing:subsidy", "contract:page-2:subsidy"],
    },
  ],
  nextActions: [
    "請將洗衣機名稱、數量與交付狀態寫入附件",
    "請提供同一標的同一期電費單與平均每度電價",
    "請確認租金補貼條款是否修改，必要時向主管機關查證",
  ],
});

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("SYMLINK_FORBIDDEN");
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(absolute)));
    else if (entry.isFile()) files.push(absolute);
    else throw new Error("UNSUPPORTED_ENTRY");
  }
  return files;
}

function mimeFor(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".json") return "application/json";
  throw new Error(`UNSUPPORTED_DEMO_EXTENSION:${ext}`);
}

function kindFor(path) {
  const root = path.split("/", 1)[0];
  const map = {
    listing: "listing",
    viewing: "viewing",
    contract: "contract",
    interaction: "interaction",
    "follow-up": "follow_up",
    truth: "truth",
    fallback: "fallback",
  };
  const kind = map[root];
  if (!kind) throw new Error(`UNSUPPORTED_DEMO_KIND:${root}`);
  return kind;
}

const candidates = (await listFiles(caseRoot))
  .filter((path) => !["manifest.json", "manifest.sha256"].includes(basename(path)))
  .sort((left, right) => left.localeCompare(right, "en"));
const files = [];
for (const absolute of candidates) {
  const bytes = await readFile(absolute);
  const path = relative(caseRoot, absolute).split(sep).join("/");
  const kind = kindFor(path);
  files.push({
    id: path.replaceAll("/", "-").replaceAll(".", "-").toLowerCase(),
    path,
    kind,
    mime: mimeFor(path),
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    provenance: {
      source:
        kind === "viewing" || kind === "follow_up"
          ? "OpenAI built-in image generation; fully synthetic RentProof fixture"
          : "RentProof developer-generated fully synthetic fixture",
      license: "Internal synthetic demo use only",
    },
  });
}

const sealedAt = new Date().toISOString();
const manifest = {
  schema: "rentproof.demo-manifest.v1",
  datasetId: "rentproof-golden",
  caseVersion: "golden-v1",
  synthetic: true,
  createdAt: sealedAt,
  sealedAt,
  files,
};
const manifestBytes = Buffer.from(json(manifest), "utf8");
await writeFile(manifestPath, manifestBytes, { flag: "wx" });
await writeFile(
  join(caseRoot, "manifest.sha256"),
  `${createHash("sha256").update(manifestBytes).digest("hex")}\n`,
  { encoding: "ascii", flag: "wx" },
);
console.log(`sealed ${files.length} files at ${caseRoot}`);
