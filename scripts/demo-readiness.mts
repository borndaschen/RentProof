import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { runToolchainCheck } from "./check-toolchain.mjs";
import {
  checkDemoReadiness,
  defaultPortAvailabilityProbe,
  defaultTcpListenerProbe,
  verifyRuntimeRootReadonly,
  verifySealedGolden,
  type DemoReadinessProfile,
} from "../src/server/demo-readiness/core.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseProfile(arguments_: readonly string[]): DemoReadinessProfile {
  if (arguments_.length === 0) return "local";
  if (arguments_.length === 2 && arguments_[0] === "--profile" && arguments_[1] === "local")
    return "local";
  if (arguments_.length === 1 && arguments_[0] === "--profile=local") return "local";
  throw new Error("DEMO_CHECK_ARGUMENTS_INVALID");
}

export function readReadinessEnvironment(): Record<string, string | undefined> {
  const filename = ".env.local";
  const path = resolve(repositoryRoot, filename);
  if (!existsSync(path)) throw new Error("RENTPROOF_ENV_FILE_MISSING");
  const fromFile = parseEnv(readFileSync(path, "utf8"));
  return { ...fromFile, ...process.env };
}

async function verifyFixedLocalVolume(path: string): Promise<void> {
  if (process.platform !== "win32" || !/^[A-Za-z]:\\/u.test(path))
    throw new Error("WINDOWS_FIXED_VOLUME_REQUIRED");
  const drive = path.slice(0, 1).replace("'", "''");
  const command = `$disk=[System.IO.DriveInfo]::new('${drive}'); [Console]::Out.Write($disk.DriveType.ToString()+'|'+$disk.DriveFormat)`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
    },
  );
  if (result.status !== 0 || result.stdout.trim().toUpperCase() !== "FIXED|NTFS")
    throw new Error("WINDOWS_FIXED_VOLUME_REQUIRED");
}

export async function runDemoReadiness(arguments_: readonly string[]): Promise<number> {
  let profile: DemoReadinessProfile;
  let environment: Record<string, string | undefined>;
  try {
    profile = parseProfile(arguments_);
    environment = readReadinessEnvironment();
  } catch (error: unknown) {
    process.stderr.write(
      `BLOCKED ${error instanceof Error ? error.message : "DEMO_CHECK_START_FAILED"} — Readiness check could not start.\n`,
    );
    return 1;
  }

  const report = await checkDemoReadiness({
    profile,
    environment,
    repositoryRoot,
    userProfile: process.env.USERPROFILE,
    localAppData: process.env.LOCALAPPDATA,
    dependencies: {
      verifyToolchain: async () => runToolchainCheck(repositoryRoot),
      verifyGolden: async (input) => {
        await verifyFixedLocalVolume(input.demoRoot);
        return verifySealedGolden(input);
      },
      verifyRuntimeRoot: async (input) => {
        await verifyFixedLocalVolume(input.runtimeRoot);
        return verifyRuntimeRootReadonly(input);
      },
      isPortAvailable: defaultPortAvailabilityProbe,
      isTcpListenerReachable: defaultTcpListenerProbe,
    },
  });

  process.stdout.write(`RentProof Demo readiness · ${report.profile}\n`);
  for (const entry of report.items)
    process.stdout.write(`${entry.level} ${entry.code} — ${entry.message}\n`);
  const totals = report.items.reduce(
    (result, entry) => ({ ...result, [entry.level]: result[entry.level] + 1 }),
    { PASS: 0, WARN: 0, BLOCKED: 0 },
  );
  process.stdout.write(
    `Summary: PASS ${String(totals.PASS)} · WARN ${String(totals.WARN)} · BLOCKED ${String(totals.BLOCKED)}\n`,
  );
  return report.blocked ? 1 : 0;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) process.exitCode = await runDemoReadiness(process.argv.slice(2));
