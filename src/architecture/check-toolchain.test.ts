import { describe, expect, it } from "vitest";
import { parseToolchainContract, verifyActualToolchain } from "../../scripts/check-toolchain.mjs";

const packageJson = JSON.stringify({
  packageManager: "pnpm@11.25.0",
  engines: { node: ">=24.20.0 <25", pnpm: "11.25.0" },
});

describe("toolchain contract", () => {
  it("accepts one exact, internally consistent Node and pnpm toolchain", () => {
    const contract = parseToolchainContract("24.20.0\n", packageJson);
    expect(contract).toEqual({ nodeVersion: "24.20.0", pnpmVersion: "11.25.0" });
    expect(
      verifyActualToolchain(contract, { nodeVersion: "v24.20.0", pnpmVersion: "11.25.0\r\n" }),
    ).toEqual({ nodeVersion: "24.20.0", pnpmVersion: "11.25.0" });
  });

  it.each([
    ["invalid package JSON", "{", "PACKAGE_JSON_INVALID"],
    [
      "missing engines",
      JSON.stringify({ packageManager: "pnpm@11.25.0" }),
      "TOOLCHAIN_CONTRACT_MISSING",
    ],
    [
      "floating pnpm",
      packageJson.replace("pnpm@11.25.0", "pnpm@^11.25.0"),
      "PACKAGE_MANAGER_CONTRACT_INVALID",
    ],
    [
      "node engine drift",
      packageJson.replace(">=24.20.0 <25", ">=24 <25"),
      "NODE_ENGINE_CONTRACT_MISMATCH",
    ],
    [
      "pnpm engine drift",
      packageJson.replace('"pnpm":"11.25.0"', '"pnpm":"11"'),
      "PNPM_ENGINE_CONTRACT_MISMATCH",
    ],
  ])("rejects %s", (_name, text, code) => {
    expect(() => parseToolchainContract("24.20.0", text)).toThrow(code);
  });

  it("rejects malformed and mismatched actual versions", () => {
    const contract = parseToolchainContract("24.20.0", packageJson);
    expect(() =>
      verifyActualToolchain(contract, { nodeVersion: "v24.19.0", pnpmVersion: "11.25.0" }),
    ).toThrow("NODE_VERSION_MISMATCH");
    expect(() =>
      verifyActualToolchain(contract, { nodeVersion: "v24.20.0", pnpmVersion: "11.24.0" }),
    ).toThrow("PNPM_VERSION_MISMATCH");
    expect(() =>
      verifyActualToolchain(contract, { nodeVersion: "nightly", pnpmVersion: "11.25.0" }),
    ).toThrow("ACTUAL_NODE_VERSION_INVALID");
  });
});
