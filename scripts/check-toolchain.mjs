import { readFileSync } from "node:fs";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exactVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function parseToolchainContract(nodeVersionText, packageJsonText) {
  const nodeVersion = parseExactVersion(nodeVersionText.trim(), "NODE_VERSION_CONTRACT_INVALID");
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonText);
  } catch {
    throw new Error("PACKAGE_JSON_INVALID");
  }
  if (!isPlainObject(packageJson) || !isPlainObject(packageJson.engines)) {
    throw new Error("TOOLCHAIN_CONTRACT_MISSING");
  }

  const packageManager = packageJson.packageManager;
  const nodeEngine = packageJson.engines.node;
  const pnpmEngine = packageJson.engines.pnpm;
  if (
    typeof packageManager !== "string" ||
    typeof nodeEngine !== "string" ||
    typeof pnpmEngine !== "string"
  ) {
    throw new Error("TOOLCHAIN_CONTRACT_MISSING");
  }
  const pnpmMatch = /^pnpm@(.+)$/u.exec(packageManager);
  if (pnpmMatch?.[1] === undefined) throw new Error("PACKAGE_MANAGER_CONTRACT_INVALID");
  const pnpmVersion = parseExactVersion(pnpmMatch[1], "PACKAGE_MANAGER_CONTRACT_INVALID");
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  if (!Number.isSafeInteger(nodeMajor)) throw new Error("NODE_VERSION_CONTRACT_INVALID");
  if (nodeEngine !== `>=${nodeVersion} <${String(nodeMajor + 1)}`) {
    throw new Error("NODE_ENGINE_CONTRACT_MISMATCH");
  }
  if (pnpmEngine !== pnpmVersion) throw new Error("PNPM_ENGINE_CONTRACT_MISMATCH");
  return Object.freeze({ nodeVersion, pnpmVersion });
}

export function verifyActualToolchain(contract, actual) {
  const actualNode = parseExactVersion(
    actual.nodeVersion.replace(/^v/u, ""),
    "ACTUAL_NODE_VERSION_INVALID",
  );
  const actualPnpm = parseExactVersion(actual.pnpmVersion.trim(), "ACTUAL_PNPM_VERSION_INVALID");
  if (actualNode !== contract.nodeVersion) throw new Error("NODE_VERSION_MISMATCH");
  if (actualPnpm !== contract.pnpmVersion) throw new Error("PNPM_VERSION_MISMATCH");
  return Object.freeze({ nodeVersion: actualNode, pnpmVersion: actualPnpm });
}

export function runToolchainCheck(
  repositoryRoot,
  pnpmUserAgent = process.env.npm_config_user_agent,
) {
  const contract = parseToolchainContract(
    readFileSync(resolve(repositoryRoot, ".node-version"), "utf8"),
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  );
  if (typeof pnpmUserAgent !== "string") throw new Error("PNPM_VERSION_CHECK_CONTEXT_MISSING");
  const pnpmMatch = /^pnpm\/(\d+\.\d+\.\d+)(?:\s|$)/u.exec(pnpmUserAgent);
  if (pnpmMatch?.[1] === undefined) throw new Error("ACTUAL_PNPM_VERSION_INVALID");
  return verifyActualToolchain(contract, {
    nodeVersion: process.version,
    pnpmVersion: pnpmMatch[1],
  });
}

function parseExactVersion(value, code) {
  if (!exactVersionPattern.test(value)) throw new Error(code);
  return value;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMainModule() {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  try {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const verified = runToolchainCheck(repositoryRoot);
    console.log(`Toolchain verified: Node ${verified.nodeVersion}, pnpm ${verified.pnpmVersion}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "TOOLCHAIN_CHECK_FAILED");
    process.exitCode = 1;
  }
}
