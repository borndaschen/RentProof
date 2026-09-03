import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..", "..");

describe("LAN Firewall UAC scripts", () => {
  it("uses a bounded hidden UAC process with cancel and timeout cleanup paths", async () => {
    const broker = await readFile(
      resolve(root, "scripts", "windows", "Start-RentProofLanFirewallUac.ps1"),
      "utf8",
    );
    expect(broker).toContain("-Verb RunAs");
    expect(broker).toContain("-WindowStyle Hidden");
    expect(broker).toContain("'-EncodedCommand'");
    expect(broker).toContain("[Text.Encoding]::Unicode.GetBytes($command)");
    expect(broker).toContain('$Value.Replace("\'", "\'\'")');
    expect(broker).toContain("WaitForExit($TimeoutSeconds * 1000)");
    expect(broker).toContain("$process.Kill()");
    expect(broker).toContain("LAN_FIREWALL_UAC_CANCELLED_OR_DENIED");
    expect(broker).not.toContain("ConfirmNoPortForwarding");
    expect(broker).not.toContain("ConfirmNoUpnpExposure");
    expect(broker).not.toContain("ConfirmNoTunnel");
  });

  it("writes an exclusive typed result and delegates only to the exact manager", async () => {
    const elevated = await readFile(
      resolve(root, "scripts", "windows", "Invoke-RentProofLanFirewallElevated.ps1"),
      "utf8",
    );
    expect(elevated).toContain("rentproof.lan-firewall-operation.v1");
    expect(elevated).toContain("[IO.FileMode]::CreateNew");
    expect(elevated).toContain("Set-RentProofLanFirewallRule.ps1");
    expect(elevated).not.toContain("New-NetFirewallRule");
    expect(elevated).not.toContain("Start-Process");
  });

  it("exposes four fixed package commands without interpolated host or port", async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "secure-lan:firewall:install-disabled": "node scripts/lan-firewall.mts InstallDisabled",
      "secure-lan:firewall:enable": "node scripts/lan-firewall.mts Enable",
      "secure-lan:firewall:disable": "node scripts/lan-firewall.mts Disable",
      "secure-lan:firewall:verify": "node scripts/lan-firewall.mts Verify",
    });
  });

  it.each([
    ["Enable", "false", "True", true],
    ["Disable", "true", "False", false],
  ] as const)(
    "passes an enum-compatible string for %s and verifies the resulting state",
    async (action, initialEnabled, expectedArgument, expectedEnabled) => {
      const directory = await mkdtemp(join(tmpdir(), "rentproof-firewall-mock-"));
      try {
        const manager = resolve(directory, "Set-RentProofLanFirewallRule.ps1");
        const capture = resolve(directory, "capture.json");
        await copyFile(
          resolve(root, "scripts", "windows", "Set-RentProofLanFirewallRule.ps1"),
          manager,
        );
        await writeFile(
          resolve(directory, "RentProofLanFirewall.Common.ps1"),
          mockFirewallCommon,
          "utf8",
        );
        const result = spawnSync(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            manager,
            "-Action",
            action,
            "-NodeExe",
            process.execPath,
            "-BindAddress",
            "172.16.102.98",
            "-Port",
            "3000",
          ],
          {
            encoding: "utf8",
            windowsHide: true,
            env: {
              ...process.env,
              MOCK_CAPTURE_PATH: capture,
              MOCK_INITIAL_ENABLED: initialEnabled,
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(await readFile(capture, "utf8"))).toEqual({
          type: "System.String",
          value: expectedArgument,
        });
        expect(JSON.parse(result.stdout)).toMatchObject({ enabled: expectedEnabled });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

const mockFirewallCommon = String.raw`
$script:RentProofRuleName = 'RentProof-Lan-Development-Managed'
$script:RentProofRuleDisplayName = 'RentProof LAN Development (Managed)'
$script:MockEnabled = $env:MOCK_INITIAL_ENABLED -eq 'true'
function Assert-RentProofRfc1918Address { param([string]$Address) }
function Resolve-RentProofNodeExecutable { param([string]$NodeExe) return $NodeExe }
function Assert-RentProofPrivateNetworkProfile { param([string]$BindAddress) return [pscustomobject]@{ NetworkCategory = 'Private' } }
function Assert-RentProofAdministrator { }
function Assert-RentProofFirewallScope { param($Snapshot, [string]$NodeExe, [string]$BindAddress, [int]$Port) }
function Get-RentProofFirewallSnapshot {
  return [pscustomobject]@{
    ruleName = $script:RentProofRuleName
    displayName = $script:RentProofRuleDisplayName
    enabled = [bool]$script:MockEnabled
  }
}
function Set-NetFirewallRule {
  param([string]$Name, [object]$Enabled)
  $capture = [pscustomobject]@{ type = $Enabled.GetType().FullName; value = [string]$Enabled } |
    ConvertTo-Json -Compress
  [IO.File]::WriteAllText($env:MOCK_CAPTURE_PATH, $capture, [Text.UTF8Encoding]::new($false))
  $script:MockEnabled = [string]$Enabled -ceq 'True'
}
`;
