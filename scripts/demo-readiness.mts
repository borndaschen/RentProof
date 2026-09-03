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
  if (
    arguments_.length === 2 &&
    arguments_[0] === "--profile" &&
    (arguments_[1] === "local" || arguments_[1] === "lan")
  ) {
    return arguments_[1];
  }
  if (arguments_.length === 1) {
    const match = /^--profile=(local|lan)$/u.exec(arguments_[0] ?? "");
    if (match?.[1] === "local" || match?.[1] === "lan") return match[1];
  }
  throw new Error("DEMO_CHECK_ARGUMENTS_INVALID");
}

export function readReadinessEnvironment(
  profile: DemoReadinessProfile,
): Record<string, string | undefined> {
  const filename = profile === "lan" ? ".env.lan.local" : ".env.local";
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

async function getLanFirewallState(
  host: string,
  port: number,
): Promise<"ready" | "missing" | "disabled" | "permission_required" | "invalid"> {
  const ruleName = "RentProof-Lan-Development-Managed";
  const inventory = spawnSync(
    "netsh.exe",
    ["advfirewall", "firewall", "show", "rule", `name=${ruleName}`, "verbose"],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 },
  );
  if (
    (inventory.status === 0 || inventory.status === 1) &&
    inventory.stdout.trim() !== "" &&
    !inventory.stdout.includes(ruleName)
  )
    return "missing";
  const stateScript = resolve(
    repositoryRoot,
    "scripts",
    "windows",
    "Get-RentProofLanFirewallState.ps1",
  );
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      stateScript,
      "-NodeExe",
      process.execPath,
      "-BindAddress",
      host,
      "-Port",
      String(port),
      "-ConfirmNoPortForwarding",
      "-ConfirmNoUpnpExposure",
      "-ConfirmNoTunnel",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 },
  );
  if (result.status !== 0) {
    if (result.stderr.includes("LAN_FIREWALL_RULE_MISSING")) return "missing";
    if (
      result.stderr.includes("PermissionDenied") ||
      result.stderr.includes("0x80041003") ||
      result.stderr.includes("拒絕存取") ||
      result.stderr.toLowerCase().includes("access is denied")
    )
      return "permission_required";
    return "invalid";
  }
  try {
    const state = JSON.parse(result.stdout) as {
      networkCategory?: unknown;
      firewallRule?: { enabled?: unknown };
    };
    if (state.networkCategory !== "Private") return "invalid";
    return state.firewallRule?.enabled === true ? "ready" : "disabled";
  } catch {
    return "invalid";
  }
}

export async function runDemoReadiness(arguments_: readonly string[]): Promise<number> {
  let profile: DemoReadinessProfile;
  let environment: Record<string, string | undefined>;
  try {
    profile = parseProfile(arguments_);
    environment = readReadinessEnvironment(profile);
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
      getLanFirewallState,
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
