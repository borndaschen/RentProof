import { describe, expect, it } from "vitest";
import {
  isCodexVirtualizedDefaultRuntimePath,
  mapLanFirewallOperatorError,
  parseLanFirewallOperationResult,
  parseLanFirewallOperatorConfig,
} from "./lan-firewall-operator";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo",
    RENTPROOF_BIND_HOST: "172.16.102.98",
    RENTPROOF_PORT: "3443",
    RENTPROOF_PUBLIC_ORIGIN: "https://172.16.102.98:3443",
    RENTPROOF_ALLOWED_HOSTS: "172.16.102.98:3443",
    RENTPROOF_ALLOWED_ORIGINS: "https://172.16.102.98:3443",
    RENTPROOF_ALLOW_REAL_DATA: "true",
    RENTPROOF_AUTH_MODE: "self_hosted",
    RENTPROOF_AUTH_TOKEN_KEY: "a".repeat(43),
    ...overrides,
  };
}

describe("parseLanFirewallOperatorConfig", () => {
  it("accepts only the exact HTTPS LAN listener and ignores exposure assertions", () => {
    expect(
      parseLanFirewallOperatorConfig(
        environment({ RENTPROOF_LAN_NO_TUNNEL: "confirmed-for-this-run" }),
        "C:\\Program Files\\nodejs\\node.exe",
      ),
    ).toEqual({
      bindAddress: "172.16.102.98",
      port: 3443,
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    });
  });

  it.each([
    { RENTPROOF_BIND_HOST: "0.0.0.0" },
    { RENTPROOF_PUBLIC_ORIGIN: "https://172.16.102.98:4000" },
    { RENTPROOF_ALLOWED_HOSTS: "*" },
    { RENTPROOF_ALLOW_REAL_DATA: "false" },
    { RENTPROOF_AUTH_MODE: "synthetic" },
    { RENTPROOF_AUTH_TOKEN_KEY: "configured" },
    { CLERK_SECRET_KEY: "configured" },
  ])("blocks unsafe configuration %#", (change) => {
    expect(() =>
      parseLanFirewallOperatorConfig(environment(change), "C:\\Program Files\\nodejs\\node.exe"),
    ).toThrow("LAN_FIREWALL_OPERATOR_CONFIG_INVALID");
  });
});

describe("parseLanFirewallOperationResult", () => {
  it("accepts a matching typed verified result", () => {
    expect(
      parseLanFirewallOperationResult(
        JSON.stringify({
          schema: "rentproof.lan-firewall-operation.v1",
          status: "PASS",
          code: "LAN_FIREWALL_RULE_DISABLED_VERIFIED",
          action: "InstallDisabled",
          enabled: false,
        }),
        "InstallDisabled",
      ),
    ).toMatchObject({ status: "PASS", enabled: false });
  });

  it.each([
    "not json",
    JSON.stringify({ schema: "wrong", status: "PASS", code: "LAN_OK", action: "Enable" }),
    JSON.stringify({
      schema: "rentproof.lan-firewall-operation.v1",
      status: "PASS",
      code: "LAN_FIREWALL_ENABLED_VERIFIED",
      action: "Disable",
      enabled: true,
    }),
    JSON.stringify({
      schema: "rentproof.lan-firewall-operation.v1",
      status: "PASS",
      code: "LAN_FIREWALL_ENABLED_VERIFIED",
      action: "Enable",
      enabled: true,
      secret: "no",
    }),
  ])("rejects malformed or mismatched results", (raw) => {
    expect(() => parseLanFirewallOperationResult(raw, "Enable")).toThrow(
      "LAN_FIREWALL_RESULT_INVALID",
    );
  });
});

describe("mapLanFirewallOperatorError", () => {
  it("surfaces safe typed dependency codes", () => {
    expect(
      mapLanFirewallOperatorError(new Error("WINDOWS_FIXED_NTFS_REQUIRED"), "RUNTIME_VOLUME"),
    ).toBe("WINDOWS_FIXED_NTFS_REQUIRED");
    expect(
      mapLanFirewallOperatorError(new Error("RUNTIME_REPARSE_POINT_DISALLOWED"), "RUNTIME_PREPARE"),
    ).toBe("RUNTIME_REPARSE_POINT_DISALLOWED");
  });

  it("maps Node and unknown failures without exposing private details", () => {
    const denied = Object.assign(new Error("private path detail"), { code: "EACCES" });
    expect(mapLanFirewallOperatorError(denied, "RUNTIME_PREPARE")).toBe(
      "LAN_FIREWALL_RUNTIME_PREPARE_EACCES",
    );
    expect(mapLanFirewallOperatorError(new Error("C:\\private\\detail"), "CONFIG")).toBe(
      "LAN_FIREWALL_CONFIG_FAILED",
    );
  });
});

describe("isCodexVirtualizedDefaultRuntimePath", () => {
  it("recognizes only the Codex package LocalCache projection of the default runtime", () => {
    expect(
      isCodexVirtualizedDefaultRuntimePath(
        "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime",
        "C:\\Users\\Demo\\AppData\\Local\\Packages\\OpenAI.Codex_123abc\\LocalCache\\Local\\RentProof\\runtime",
      ),
    ).toBe(true);
  });

  it.each([
    [
      "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime",
      "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime",
    ],
    [
      "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime",
      "C:\\Users\\Demo\\AppData\\Local\\Packages\\Other.App_123\\LocalCache\\Local\\RentProof\\runtime",
    ],
    [
      "C:\\Users\\Demo\\AppData\\Local\\RentProof\\custom",
      "C:\\Users\\Demo\\AppData\\Local\\Packages\\OpenAI.Codex_123\\LocalCache\\Local\\RentProof\\runtime",
    ],
    [
      "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime",
      "D:\\Packages\\OpenAI.Codex_123\\LocalCache\\Local\\RentProof\\runtime",
    ],
  ])("rejects non-matching requested/canonical pairs", (requested, canonical) => {
    expect(isCodexVirtualizedDefaultRuntimePath(requested, canonical)).toBe(false);
  });
});
