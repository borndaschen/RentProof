import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rmdir, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { verifyRuntimeRootReadonly } from "../src/server/demo-readiness/core.ts";
import {
  LanFirewallOperatorActionSchema,
  isCodexVirtualizedDefaultRuntimePath,
  mapLanFirewallOperatorError,
  parseLanFirewallOperationResult,
  parseLanFirewallOperatorConfig,
  type LanFirewallOperatorAction,
  type LanFirewallOperatorStage,
} from "../src/server/network/lan-firewall-operator.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const action = LanFirewallOperatorActionSchema.parse(process.argv[2]);

function readEnvironment(): Record<string, string | undefined> {
  const path = resolve(repositoryRoot, ".env.secure-lan.local");
  if (!existsSync(path)) throw new Error("RENTPROOF_ENV_FILE_MISSING");
  return { ...parseEnv(readFileSync(path, "utf8")), ...process.env };
}

async function verifyFixedNtfs(path: string): Promise<void> {
  if (process.platform !== "win32" || !/^[A-Za-z]:\\/u.test(path))
    throw new Error("WINDOWS_FIXED_NTFS_REQUIRED");
  const drive = path.slice(0, 1);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$disk=[System.IO.DriveInfo]::new('${drive}'); [Console]::Out.Write($disk.DriveType.ToString()+'|'+$disk.DriveFormat)`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 5_000 },
  );
  if (result.status !== 0 || result.stdout.trim().toUpperCase() !== "FIXED|NTFS") {
    throw new Error("WINDOWS_FIXED_NTFS_REQUIRED");
  }
}

async function createValidatedResultDirectory(input: {
  runtimeRoot: string;
  demoRoot: string;
}): Promise<string> {
  await verifyFixedNtfs(input.runtimeRoot);
  await verifyRuntimeRootReadonly({
    runtimeRoot: input.runtimeRoot,
    repositoryRoot,
    demoRoot: input.demoRoot,
  });
  await mkdir(input.runtimeRoot, { recursive: true });
  await verifyRuntimeRootReadonly({
    runtimeRoot: input.runtimeRoot,
    repositoryRoot,
    demoRoot: input.demoRoot,
  });
  const directory = await mkdtemp(join(input.runtimeRoot, "firewall-operation-"));
  const resolvedRoot = await realpath(input.runtimeRoot);
  const resolvedDirectory = await realpath(directory);
  const relative = win32.relative(resolvedRoot, resolvedDirectory);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    win32.isAbsolute(relative) ||
    (await lstat(resolvedDirectory)).isSymbolicLink()
  ) {
    throw new Error("LAN_FIREWALL_RESULT_PATH_INVALID");
  }
  return resolvedDirectory;
}

function parseBrokerFailure(stdout: string): string {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      "code" in value &&
      typeof value.code === "string" &&
      /^LAN_[A-Z0-9_]+$/u.test(value.code)
    )
      return value.code;
  } catch {
    // Safe fallback below.
  }
  return "LAN_FIREWALL_UAC_PROCESS_FAILED";
}

async function cleanupResult(directory: string, resultPath: string): Promise<void> {
  const root = await realpath(directory);
  if (!sameWindowsPath(win32.dirname(resultPath), root)) {
    throw new Error("LAN_FIREWALL_RESULT_PATH_INVALID");
  }
  await unlink(resultPath).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) throw error;
  });
  await rmdir(root);
}

export async function runLanFirewallOperator(
  requestedAction: LanFirewallOperatorAction,
): Promise<number> {
  let resultDirectory: string | undefined;
  let resultPath: string | undefined;
  let requestedRuntimeRoot: string | undefined;
  let usesDefaultRuntimeRoot = false;
  let stage: LanFirewallOperatorStage = "CONFIG";
  try {
    const environment = readEnvironment();
    const configuration = parseLanFirewallOperatorConfig(environment, process.execPath);
    const userProfile = process.env.USERPROFILE ?? "";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const demoRoot =
      environment["RENTPROOF_DEMO_DIR"]?.trim() || win32.join(userProfile, "RentProof-Demo");
    const explicitRuntimeRoot = environment["RENTPROOF_RUNTIME_DIR"]?.trim();
    usesDefaultRuntimeRoot = !explicitRuntimeRoot;
    const runtimeRoot = explicitRuntimeRoot || win32.join(localAppData, "RentProof", "runtime");
    requestedRuntimeRoot = runtimeRoot;
    if (!userProfile || !localAppData) throw new Error("LAN_FIREWALL_RUNTIME_CONFIG_INVALID");
    stage = "RUNTIME_VOLUME";
    await verifyFixedNtfs(runtimeRoot);
    stage = "RUNTIME_PREPARE";
    resultDirectory = await createValidatedResultDirectory({ runtimeRoot, demoRoot });
    resultPath = win32.join(resultDirectory, "result.json");

    const broker = resolve(
      repositoryRoot,
      "scripts",
      "windows",
      "Start-RentProofLanFirewallUac.ps1",
    );
    stage = "UAC_BROKER";
    const processResult = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        broker,
        "-Action",
        requestedAction,
        "-NodeExe",
        configuration.nodeExecutable,
        "-BindAddress",
        configuration.bindAddress,
        "-Port",
        String(configuration.port),
        "-RuntimeRoot",
        runtimeRoot,
        "-ResultPath",
        resultPath,
        "-TimeoutSeconds",
        "60",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 70_000 },
    );

    if (processResult.error !== undefined) {
      const code = isNodeError(processResult.error, "ETIMEDOUT")
        ? "LAN_FIREWALL_UAC_BROKER_TIMEOUT"
        : "LAN_FIREWALL_UAC_START_FAILED";
      process.stdout.write(`BLOCKED ${code} — Firewall operation did not complete.\n`);
      return 1;
    }
    if (!existsSync(resultPath)) {
      const code = parseBrokerFailure(processResult.stdout);
      process.stdout.write(`BLOCKED ${code} — Firewall operation produced no verified result.\n`);
      return 1;
    }
    stage = "RESULT_PARSE";
    const raw = await readFile(resultPath, { encoding: "utf8" });
    const verified = parseLanFirewallOperationResult(raw, requestedAction);
    process.stdout.write(
      `${verified.status} ${verified.code} — Exact Private-profile Firewall rule ${verified.enabled === true ? "is enabled" : verified.enabled === false ? "is disabled" : "operation was blocked"}.\n`,
    );
    return verified.status === "PASS" && processResult.status === 0 ? 0 : 1;
  } catch (error: unknown) {
    let code = mapLanFirewallOperatorError(error, stage);
    if (
      code === "RUNTIME_REPARSE_POINT_DISALLOWED" &&
      usesDefaultRuntimeRoot &&
      requestedRuntimeRoot !== undefined
    ) {
      try {
        const canonicalRuntimeRoot = await realpath(requestedRuntimeRoot);
        if (isCodexVirtualizedDefaultRuntimePath(requestedRuntimeRoot, canonicalRuntimeRoot)) {
          code = "LAN_FIREWALL_EXTERNAL_TERMINAL_REQUIRED";
        }
      } catch {
        // Preserve the original typed runtime blocker.
      }
    }
    const message =
      code === "LAN_FIREWALL_EXTERNAL_TERMINAL_REQUIRED"
        ? "Codex filesystem virtualization is active; run this exact pnpm command in a normal PowerShell terminal."
        : "Firewall operation failed closed.";
    process.stdout.write(`BLOCKED ${code} — ${message}\n`);
    return 1;
  } finally {
    if (resultDirectory !== undefined && resultPath !== undefined) {
      await cleanupResult(resultDirectory, resultPath).catch(() => undefined);
    }
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

process.exitCode = await runLanFirewallOperator(action);
