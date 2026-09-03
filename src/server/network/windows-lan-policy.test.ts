import { describe, expect, it } from "vitest";
import {
  RENTPROOF_FIREWALL_DISPLAY_NAME,
  RENTPROOF_FIREWALL_RULE_NAME,
  buildFirewallManagementInvocation,
  buildWindowsLanNetworkPolicy,
  isRfc1918Ipv4,
  verifyWindowsLanPreflight,
} from "./windows-lan-policy";

const configuration = {
  bindAddress: "192.168.10.24",
  port: 3000,
  publicOrigin: "http://192.168.10.24:3000",
  allowedHosts: ["192.168.10.24:3000"],
  allowedOrigins: ["http://192.168.10.24:3000"],
  nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
};

function policy() {
  return buildWindowsLanNetworkPolicy(configuration);
}

function firewall(overrides: Record<string, unknown> = {}) {
  return {
    ruleName: RENTPROOF_FIREWALL_RULE_NAME,
    displayName: RENTPROOF_FIREWALL_DISPLAY_NAME,
    direction: "Inbound",
    action: "Allow",
    protocol: "TCP",
    localAddress: configuration.bindAddress,
    localPort: configuration.port,
    remoteAddress: "LocalSubnet",
    profiles: ["Private"],
    programPath: configuration.nodeExecutable,
    enabled: false,
    ...overrides,
  };
}

function facts(overrides: Record<string, unknown> = {}) {
  return {
    phase: "before_enable",
    configuredLocalAddresses: [configuration.bindAddress],
    networkCategory: "Private",
    firewallRule: firewall(),
    portForwardingDetected: false,
    upnpExposureDetected: false,
    tunnelDetected: false,
    ...overrides,
  };
}

function expectCode(run: () => unknown, code: string) {
  expect(run).toThrow(expect.objectContaining({ code }));
}

describe("buildWindowsLanNetworkPolicy", () => {
  it("builds an exact disabled-by-default Private LocalSubnet rule", () => {
    expect(policy()).toEqual({
      bindAddress: "192.168.10.24",
      port: 3000,
      exactHost: "192.168.10.24:3000",
      exactOrigin: "http://192.168.10.24:3000",
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      firewall: {
        ruleName: RENTPROOF_FIREWALL_RULE_NAME,
        displayName: RENTPROOF_FIREWALL_DISPLAY_NAME,
        direction: "Inbound",
        action: "Allow",
        protocol: "TCP",
        localAddress: "192.168.10.24",
        localPort: 3000,
        remoteAddress: "LocalSubnet",
        profiles: ["Private"],
        programPath: "C:\\Program Files\\nodejs\\node.exe",
        enabledByDefault: false,
      },
    });
    expect(Object.isFrozen(policy().firewall)).toBe(true);
  });

  it.each([
    "10.0.0.1",
    "10.255.255.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
    "192.168.255.254",
  ])("accepts RFC1918 address %s", (address) => {
    expect(isRfc1918Ipv4(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "127.0.0.1",
    "169.254.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "8.8.8.8",
    "224.0.0.1",
    "::",
    "::1",
    "192.168.001.1",
    "256.1.1.1",
    "localhost",
  ])("rejects unsafe bind %s", (bindAddress) => {
    expect(isRfc1918Ipv4(bindAddress)).toBe(false);
    expectCode(
      () =>
        buildWindowsLanNetworkPolicy({
          ...configuration,
          bindAddress,
          publicOrigin: `http://${bindAddress}:3000`,
          allowedHosts: [`${bindAddress}:3000`],
          allowedOrigins: [`http://${bindAddress}:3000`],
        }),
      "LAN_BIND_UNSAFE",
    );
  });

  it.each([
    "https://192.168.10.24:3000",
    "http://192.168.10.24:3001",
    "http://192.168.10.24:3000/path",
    "http://user@192.168.10.24:3000",
    "http://192.168.10.24:3000?query=1",
    "not a URL",
  ])("rejects non-exact origin %s", (publicOrigin) => {
    expectCode(
      () => buildWindowsLanNetworkPolicy({ ...configuration, publicOrigin }),
      "LAN_ORIGIN_UNSAFE",
    );
  });

  it("rejects wildcard, alternate, and multiple Host/Origin allowlists", () => {
    for (const change of [
      { allowedHosts: ["*"] },
      { allowedHosts: [configuration.allowedHosts[0], "localhost:3000"] },
      { allowedOrigins: ["*"] },
      { allowedOrigins: [configuration.allowedOrigins[0], "null"] },
    ]) {
      expectCode(
        () => buildWindowsLanNetworkPolicy({ ...configuration, ...change }),
        "LAN_HOST_ALLOWLIST_UNSAFE",
      );
    }
  });

  it.each([
    "node.exe",
    "\\\\server\\share\\node.exe",
    "C:\\Program Files\\nodejs\\..\\evil.exe",
    "C:\\Program Files\\nodejs\\npm.exe",
    "C:\\Program Files\\nodejs\\node.exe:stream",
  ])("rejects unsafe Node executable %s", (nodeExecutable) => {
    expectCode(
      () => buildWindowsLanNetworkPolicy({ ...configuration, nodeExecutable }),
      "LAN_NODE_EXECUTABLE_UNSAFE",
    );
  });

  it("uses a strict configuration schema", () => {
    expectCode(
      () => buildWindowsLanNetworkPolicy({ ...configuration, allowPublic: true }),
      "LAN_BIND_UNSAFE",
    );
  });
});

describe("verifyWindowsLanPreflight", () => {
  it("requires disabled before enable and after demo", () => {
    expect(verifyWindowsLanPreflight(policy(), facts())).toEqual({ ok: true });
    expect(verifyWindowsLanPreflight(policy(), facts({ phase: "after_demo" }))).toEqual({
      ok: true,
    });
    expectCode(
      () =>
        verifyWindowsLanPreflight(policy(), facts({ firewallRule: firewall({ enabled: true }) })),
      "LAN_FIREWALL_RULE_STALE_ENABLED",
    );
  });

  it("requires enabled only when ready to serve", () => {
    expect(
      verifyWindowsLanPreflight(
        policy(),
        facts({ phase: "ready_to_serve", firewallRule: firewall({ enabled: true }) }),
      ),
    ).toEqual({ ok: true });
    expectCode(
      () => verifyWindowsLanPreflight(policy(), facts({ phase: "ready_to_serve" })),
      "LAN_FIREWALL_RULE_DISABLED",
    );
  });

  it("requires the bind address on an active interface and a Private profile", () => {
    expectCode(
      () => verifyWindowsLanPreflight(policy(), facts({ configuredLocalAddresses: [] })),
      "LAN_BIND_UNSAFE",
    );
    for (const networkCategory of ["Public", "DomainAuthenticated", "Unknown"] as const) {
      expectCode(
        () => verifyWindowsLanPreflight(policy(), facts({ networkCategory })),
        "LAN_NETWORK_PROFILE_NOT_PRIVATE",
      );
    }
  });

  it.each([
    { portForwardingDetected: true },
    { upnpExposureDetected: true },
    { tunnelDetected: true },
  ])("rejects public exposure flags", (exposure) => {
    expectCode(
      () => verifyWindowsLanPreflight(policy(), facts(exposure)),
      "LAN_PUBLIC_EXPOSURE_DETECTED",
    );
  });

  it("requires the fixed firewall rule", () => {
    expectCode(
      () => verifyWindowsLanPreflight(policy(), facts({ firewallRule: null })),
      "LAN_FIREWALL_RULE_MISSING",
    );
  });

  it.each([
    ["name", { ruleName: "Other" }],
    ["display", { displayName: "Other" }],
    ["direction", { direction: "Outbound" }],
    ["action", { action: "Block" }],
    ["protocol", { protocol: "UDP" }],
    ["local address", { localAddress: "0.0.0.0" }],
    ["port", { localPort: 3001 }],
    ["remote", { remoteAddress: "Any" }],
    ["Public profile", { profiles: ["Public"] }],
    ["Private plus Public", { profiles: ["Private", "Public"] }],
    ["program", { programPath: "C:\\Other\\node.exe" }],
  ] as const)("rejects firewall scope mismatch: %s", (_label, change) => {
    expectCode(
      () => verifyWindowsLanPreflight(policy(), facts({ firewallRule: firewall(change) })),
      "LAN_FIREWALL_RULE_SCOPE_INVALID",
    );
  });

  it("fails closed on malformed probe facts", () => {
    expectCode(
      () => verifyWindowsLanPreflight(policy(), { ...facts(), unexpected: true }),
      "LAN_FIREWALL_RULE_SCOPE_INVALID",
    );
  });
});

describe("buildFirewallManagementInvocation", () => {
  it("returns argument arrays rather than an interpolated shell command", () => {
    expect(
      buildFirewallManagementInvocation({
        scriptPath: "C:\\Work\\RentProof\\scripts\\windows\\Set-RentProofLanFirewallRule.ps1",
        action: "Enable",
        policy: policy(),
        whatIf: true,
      }),
    ).toEqual({
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        "C:\\Work\\RentProof\\scripts\\windows\\Set-RentProofLanFirewallRule.ps1",
        "-Action",
        "Enable",
        "-NodeExe",
        configuration.nodeExecutable,
        "-BindAddress",
        configuration.bindAddress,
        "-Port",
        "3000",
        "-WhatIf",
      ],
      requiresElevation: true,
    });
  });

  it("marks Verify as non-elevated and rejects unsafe script paths", () => {
    expect(
      buildFirewallManagementInvocation({
        scriptPath: "C:\\Work\\RentProof\\scripts\\windows\\Get-State.ps1",
        action: "Verify",
        policy: policy(),
      }).requiresElevation,
    ).toBe(false);
    for (const scriptPath of [
      "script.ps1",
      "\\\\server\\share\\script.ps1",
      "C:\\Work\\..\\evil.ps1",
      "C:\\Work\\script.cmd",
      "C:\\Work\\script.ps1:stream",
    ]) {
      expectCode(
        () =>
          buildFirewallManagementInvocation({
            scriptPath,
            action: "Verify",
            policy: policy(),
          }),
        "LAN_FIREWALL_RULE_SCOPE_INVALID",
      );
    }
  });
});
