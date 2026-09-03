import { win32 } from "node:path";
import { z } from "zod";

export const RENTPROOF_FIREWALL_RULE_NAME = "RentProof-Lan-Secure-Demo-Managed" as const;
export const RENTPROOF_FIREWALL_DISPLAY_NAME = "RentProof LAN HTTPS Demo (Managed)" as const;

export type LanNetworkPolicyErrorCode =
  | "LAN_BIND_UNSAFE"
  | "LAN_ORIGIN_UNSAFE"
  | "LAN_HOST_ALLOWLIST_UNSAFE"
  | "LAN_NODE_EXECUTABLE_UNSAFE"
  | "LAN_NETWORK_PROFILE_NOT_PRIVATE"
  | "LAN_FIREWALL_RULE_MISSING"
  | "LAN_FIREWALL_RULE_SCOPE_INVALID"
  | "LAN_FIREWALL_RULE_STALE_ENABLED"
  | "LAN_FIREWALL_RULE_DISABLED"
  | "LAN_PUBLIC_EXPOSURE_DETECTED";

export class LanNetworkPolicyError extends Error {
  override readonly name = "LanNetworkPolicyError";
  readonly code: LanNetworkPolicyErrorCode;

  constructor(code: LanNetworkPolicyErrorCode) {
    super(code);
    this.code = code;
  }
}

const LanNetworkConfigurationSchema = z
  .object({
    bindAddress: z.string(),
    port: z.number().int().min(1).max(65_535),
    publicOrigin: z.string(),
    allowedHosts: z.array(z.string()).min(1).max(4),
    allowedOrigins: z.array(z.string()).min(1).max(4),
    nodeExecutable: z.string(),
  })
  .strict();

export type WindowsLanFirewallSpec = {
  ruleName: typeof RENTPROOF_FIREWALL_RULE_NAME;
  displayName: typeof RENTPROOF_FIREWALL_DISPLAY_NAME;
  direction: "Inbound";
  action: "Allow";
  protocol: "TCP";
  localAddress: string;
  localPort: number;
  remoteAddress: "LocalSubnet";
  profiles: readonly ["Private"];
  programPath: string;
  enabledByDefault: false;
};

export type WindowsLanNetworkPolicy = {
  bindAddress: string;
  port: number;
  exactHost: string;
  exactOrigin: string;
  nodeExecutable: string;
  firewall: WindowsLanFirewallSpec;
};

export function buildWindowsLanNetworkPolicy(
  untrustedConfiguration: unknown,
): WindowsLanNetworkPolicy {
  const parsed = LanNetworkConfigurationSchema.safeParse(untrustedConfiguration);
  if (!parsed.success) {
    throw new LanNetworkPolicyError("LAN_BIND_UNSAFE");
  }
  const configuration = parsed.data;
  if (!isRfc1918Ipv4(configuration.bindAddress)) {
    throw new LanNetworkPolicyError("LAN_BIND_UNSAFE");
  }
  const exactHost = `${configuration.bindAddress}:${configuration.port}`;
  const exactOrigin = `https://${exactHost}`;
  if (
    !isExactHttpsOrigin(configuration.publicOrigin, configuration.bindAddress, configuration.port)
  ) {
    throw new LanNetworkPolicyError("LAN_ORIGIN_UNSAFE");
  }
  if (
    configuration.allowedHosts.length !== 1 ||
    configuration.allowedHosts[0] !== exactHost ||
    configuration.allowedOrigins.length !== 1 ||
    configuration.allowedOrigins[0] !== exactOrigin
  ) {
    throw new LanNetworkPolicyError("LAN_HOST_ALLOWLIST_UNSAFE");
  }
  const nodeExecutable = validateNodeExecutable(configuration.nodeExecutable);
  return {
    bindAddress: configuration.bindAddress,
    port: configuration.port,
    exactHost,
    exactOrigin,
    nodeExecutable,
    firewall: Object.freeze({
      ruleName: RENTPROOF_FIREWALL_RULE_NAME,
      displayName: RENTPROOF_FIREWALL_DISPLAY_NAME,
      direction: "Inbound",
      action: "Allow",
      protocol: "TCP",
      localAddress: configuration.bindAddress,
      localPort: configuration.port,
      remoteAddress: "LocalSubnet",
      profiles: Object.freeze(["Private"] as const),
      programPath: nodeExecutable,
      enabledByDefault: false,
    }),
  };
}

const FirewallRuleSnapshotSchema = z
  .object({
    ruleName: z.string(),
    displayName: z.string(),
    direction: z.string(),
    action: z.string(),
    protocol: z.string(),
    localAddress: z.string(),
    localPort: z.number().int(),
    remoteAddress: z.string(),
    profiles: z.array(z.string()),
    programPath: z.string(),
    enabled: z.boolean(),
  })
  .strict();

const LanPreflightFactsSchema = z
  .object({
    phase: z.enum(["before_enable", "ready_to_serve", "after_demo"]),
    configuredLocalAddresses: z.array(z.string()).max(256),
    networkCategory: z.enum(["Private", "Public", "DomainAuthenticated", "Unknown"]),
    firewallRule: FirewallRuleSnapshotSchema.nullable(),
    portForwardingDetected: z.boolean(),
    upnpExposureDetected: z.boolean(),
    tunnelDetected: z.boolean(),
  })
  .strict();

export type LanPreflightFacts = z.infer<typeof LanPreflightFactsSchema>;

export function verifyWindowsLanPreflight(
  policy: WindowsLanNetworkPolicy,
  untrustedFacts: unknown,
): { ok: true } {
  const parsed = LanPreflightFactsSchema.safeParse(untrustedFacts);
  if (!parsed.success) {
    throw new LanNetworkPolicyError("LAN_FIREWALL_RULE_SCOPE_INVALID");
  }
  const facts = parsed.data;
  if (!facts.configuredLocalAddresses.includes(policy.bindAddress)) {
    throw new LanNetworkPolicyError("LAN_BIND_UNSAFE");
  }
  if (facts.networkCategory !== "Private") {
    throw new LanNetworkPolicyError("LAN_NETWORK_PROFILE_NOT_PRIVATE");
  }
  if (facts.portForwardingDetected || facts.upnpExposureDetected || facts.tunnelDetected) {
    throw new LanNetworkPolicyError("LAN_PUBLIC_EXPOSURE_DETECTED");
  }
  if (facts.firewallRule === null) {
    throw new LanNetworkPolicyError("LAN_FIREWALL_RULE_MISSING");
  }
  if (!firewallRuleMatches(policy.firewall, facts.firewallRule)) {
    throw new LanNetworkPolicyError("LAN_FIREWALL_RULE_SCOPE_INVALID");
  }
  if (facts.phase === "ready_to_serve" && !facts.firewallRule.enabled) {
    throw new LanNetworkPolicyError("LAN_FIREWALL_RULE_DISABLED");
  }
  if (facts.phase !== "ready_to_serve" && facts.firewallRule.enabled) {
    throw new LanNetworkPolicyError("LAN_FIREWALL_RULE_STALE_ENABLED");
  }
  return { ok: true };
}

export type FirewallManagementAction = "Verify" | "InstallDisabled" | "Enable" | "Disable";

export type PowerShellInvocation = {
  executable: "powershell.exe";
  args: readonly string[];
  requiresElevation: boolean;
};

export function buildFirewallManagementInvocation(input: {
  scriptPath: string;
  action: FirewallManagementAction;
  policy: WindowsLanNetworkPolicy;
  whatIf?: boolean;
}): PowerShellInvocation {
  const scriptPath = validatePowerShellScriptPath(input.scriptPath);
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-File",
    scriptPath,
    "-Action",
    input.action,
    "-NodeExe",
    input.policy.nodeExecutable,
    "-BindAddress",
    input.policy.bindAddress,
    "-Port",
    String(input.policy.port),
  ];
  if (input.whatIf === true) {
    args.push("-WhatIf");
  }
  return {
    executable: "powershell.exe",
    args: Object.freeze(args),
    requiresElevation: input.action !== "Verify",
  };
}

export function isRfc1918Ipv4(address: string): boolean {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/u.test(address)) {
    return false;
  }
  const octets = address.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] !== undefined && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isExactHttpsOrigin(origin: string, address: string, port: number): boolean {
  try {
    const parsed = new URL(origin);
    return (
      origin === `https://${address}:${port}` &&
      parsed.protocol === "https:" &&
      parsed.hostname === address &&
      parsed.port === String(port) &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.pathname === "/" &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0
    );
  } catch {
    return false;
  }
}

function validateNodeExecutable(path: string): string {
  if (
    path.length === 0 ||
    path !== path.trim() ||
    !/^[a-z]:[\\/]/iu.test(path) ||
    !win32.isAbsolute(path) ||
    path.startsWith("\\\\") ||
    path.includes("\0") ||
    path.split(/[\\/]/u).includes("..")
  ) {
    throw new LanNetworkPolicyError("LAN_NODE_EXECUTABLE_UNSAFE");
  }
  const normalized = win32.normalize(path);
  if (
    win32.basename(normalized).toLowerCase() !== "node.exe" ||
    normalized.slice(2).includes(":")
  ) {
    throw new LanNetworkPolicyError("LAN_NODE_EXECUTABLE_UNSAFE");
  }
  return normalized;
}

function validatePowerShellScriptPath(path: string): string {
  if (
    path.length === 0 ||
    path !== path.trim() ||
    !/^[a-z]:[\\/]/iu.test(path) ||
    !win32.isAbsolute(path) ||
    path.startsWith("\\\\") ||
    path.includes("\0") ||
    path.split(/[\\/]/u).includes("..")
  ) {
    throw new LanNetworkPolicyError("LAN_FIREWALL_RULE_SCOPE_INVALID");
  }
  const normalized = win32.normalize(path);
  if (!normalized.toLowerCase().endsWith(".ps1") || normalized.slice(2).includes(":")) {
    throw new LanNetworkPolicyError("LAN_FIREWALL_RULE_SCOPE_INVALID");
  }
  return normalized;
}

function firewallRuleMatches(
  expected: WindowsLanFirewallSpec,
  actual: z.infer<typeof FirewallRuleSnapshotSchema>,
): boolean {
  return (
    actual.ruleName === expected.ruleName &&
    actual.displayName === expected.displayName &&
    actual.direction === expected.direction &&
    actual.action === expected.action &&
    actual.protocol.toUpperCase() === expected.protocol &&
    actual.localAddress === expected.localAddress &&
    actual.localPort === expected.localPort &&
    actual.remoteAddress === expected.remoteAddress &&
    actual.profiles.length === 1 &&
    actual.profiles[0] === "Private" &&
    normalizeWindowsPath(actual.programPath) === normalizeWindowsPath(expected.programPath)
  );
}

function normalizeWindowsPath(path: string): string {
  return win32.normalize(path).toLowerCase();
}
