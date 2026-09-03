[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$NodeExe,
    [Parameter(Mandatory = $true)][string]$BindAddress,
    [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
    [Parameter(Mandatory = $true)][switch]$ConfirmNoPortForwarding,
    [Parameter(Mandatory = $true)][switch]$ConfirmNoUpnpExposure,
    [Parameter(Mandatory = $true)][switch]$ConfirmNoTunnel
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RentProofLanFirewall.Common.ps1')

Assert-RentProofRfc1918Address -Address $BindAddress
$resolvedNode = Resolve-RentProofNodeExecutable -NodeExe $NodeExe
$profile = Assert-RentProofPrivateNetworkProfile -BindAddress $BindAddress
$snapshot = Get-RentProofFirewallSnapshot
if ($null -eq $snapshot) {
    throw 'LAN_FIREWALL_RULE_MISSING'
}
Assert-RentProofFirewallScope -Snapshot $snapshot -NodeExe $resolvedNode -BindAddress $BindAddress -Port $Port

[pscustomobject]@{
    configuredLocalAddresses = @($BindAddress)
    networkCategory = $profile.NetworkCategory.ToString()
    firewallRule = $snapshot
    portForwardingDetected = -not $ConfirmNoPortForwarding.IsPresent
    upnpExposureDetected = -not $ConfirmNoUpnpExposure.IsPresent
    tunnelDetected = -not $ConfirmNoTunnel.IsPresent
} | ConvertTo-Json -Depth 6
