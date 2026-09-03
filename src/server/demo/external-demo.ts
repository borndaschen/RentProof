import "server-only";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, join, win32 } from "node:path";
import { verifyAndParseManifestBytes, verifyRuntimeManifestFiles } from "@/adapters/demo";
import type { DemoManifestFile } from "@/domain/demo";
import { getServerEnvironment } from "@/server/env";

const browserVisibleKinds = new Set<DemoManifestFile["kind"]>([
  "listing",
  "viewing",
  "contract",
  "follow_up",
]);
const GOLDEN_V1_MANIFEST_SHA256 =
  "f3797356a1e3ea4bbed7a87802fdaaa001985557fb7b51845a9f6a4454157d7b";

export interface VerifiedExternalDemo {
  caseRoot: string;
  manifestHash: string;
  files: readonly DemoManifestFile[];
}

let cachedDemo: Promise<VerifiedExternalDemo> | undefined;

function resolveDemoRoot(): string {
  const explicit = process.env["RENTPROOF_DEMO_DIR"]?.trim();
  const userProfile = process.env["USERPROFILE"]?.trim();
  const root = explicit || (userProfile ? join(userProfile, "RentProof-Demo") : undefined);
  if (!root) throw new Error("DEMO_DIR_MISSING");
  if (!/^[A-Za-z]:\\/u.test(root) || root.startsWith("\\\\")) {
    throw new Error("DEMO_DIR_UNSAFE");
  }
  return root;
}

async function loadVerifiedExternalDemo(): Promise<VerifiedExternalDemo> {
  const version = getServerEnvironment().RENTPROOF_DEMO_CASE_VERSION;
  const demoRoot = resolveDemoRoot();
  const caseRoot = join(demoRoot, "cases", version);
  await assertSafeDemoRoot(demoRoot, caseRoot);
  let manifestBytes: Uint8Array;
  let sealBytes: Uint8Array;
  try {
    [manifestBytes, sealBytes] = await Promise.all([
      readFile(join(caseRoot, "manifest.json")),
      readFile(join(caseRoot, "manifest.sha256")),
    ]);
  } catch {
    throw new Error("DEMO_DIR_MISSING");
  }
  const sealed = verifyAndParseManifestBytes(manifestBytes, sealBytes);
  if (sealed.manifest.caseVersion !== version || sealed.manifest.synthetic !== true) {
    throw new Error("DEMO_MANIFEST_SCHEMA_INVALID");
  }
  if (version === "golden-v1" && sealed.manifestSha256 !== GOLDEN_V1_MANIFEST_SHA256) {
    throw new Error("DEMO_MANIFEST_SEAL_MISMATCH");
  }
  await verifyRuntimeManifestFiles(caseRoot, sealed.manifest);
  return {
    caseRoot,
    manifestHash: sealed.manifestSha256,
    files: sealed.manifest.files,
  };
}

async function assertSafeDemoRoot(demoRoot: string, caseRoot: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("DEMO_DIR_UNSAFE");
  const requestedRoot = win32.normalize(demoRoot);
  const requestedCase = win32.normalize(caseRoot);
  const repositoryRoot = process.env["RENTPROOF_REPOSITORY_ROOT"];
  if (!repositoryRoot) throw new Error("DEMO_DIR_UNSAFE");
  const [rootReal, caseReal, rootStat, caseStat] = await Promise.all([
    realpath(requestedRoot),
    realpath(requestedCase),
    lstat(requestedRoot),
    lstat(requestedCase),
  ]);
  if (
    !rootStat.isDirectory() ||
    !caseStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    caseStat.isSymbolicLink() ||
    !sameWindowsPath(rootReal, requestedRoot) ||
    !sameWindowsPath(caseReal, requestedCase) ||
    win32.parse(rootReal).root.toLowerCase() !== win32.parse(repositoryRoot).root.toLowerCase()
  ) {
    throw new Error("DEMO_DIR_UNSAFE");
  }
  const userProfile = process.env["USERPROFILE"];
  const localAppData = process.env["LOCALAPPDATA"];
  const protectedRoots = [
    repositoryRoot,
    win32.join(repositoryRoot, "public"),
    ...(userProfile ? [win32.join(userProfile, "Documents")] : []),
    ...(localAppData ? [win32.join(localAppData, "RentProof", "runtime")] : []),
    ...["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
      .map((name) => process.env[name])
      .filter((value): value is string => Boolean(value)),
  ];
  if (protectedRoots.some((protectedRoot) => windowsPathsOverlap(rootReal, protectedRoot))) {
    throw new Error("DEMO_DIR_UNSAFE");
  }
}

function sameWindowsPath(left: string, right: string): boolean {
  return (
    win32
      .normalize(left)
      .replace(/[\\/]+$/u, "")
      .toLowerCase() ===
    win32
      .normalize(right)
      .replace(/[\\/]+$/u, "")
      .toLowerCase()
  );
}

function windowsPathsOverlap(left: string, right: string): boolean {
  const leftToRight = win32.relative(left, right);
  const rightToLeft = win32.relative(right, left);
  return (
    sameWindowsPath(left, right) ||
    (leftToRight !== "" && !leftToRight.startsWith("..") && !win32.isAbsolute(leftToRight)) ||
    (rightToLeft !== "" && !rightToLeft.startsWith("..") && !win32.isAbsolute(rightToLeft))
  );
}

export function getVerifiedExternalDemo(): Promise<VerifiedExternalDemo> {
  cachedDemo ??= loadVerifiedExternalDemo().catch((error: unknown) => {
    cachedDemo = undefined;
    throw error;
  });
  return cachedDemo;
}

export async function getBrowserVisibleDemoArtifact(
  artifactId: string,
): Promise<{ absolutePath: string; file: DemoManifestFile } | null> {
  const demo = await getVerifiedExternalDemo();
  const file = demo.files.find((candidate) => candidate.id === artifactId);
  if (!file || !browserVisibleKinds.has(file.kind)) return null;
  if (!new Set(["image/jpeg", "image/png", "application/pdf"]).has(file.mime)) return null;
  const absolutePath = join(demo.caseRoot, ...file.path.split("/"));
  return { absolutePath, file };
}

export function safeArtifactFilename(file: DemoManifestFile): string {
  return basename(file.path).replaceAll(/[^A-Za-z0-9._-]/gu, "_");
}
