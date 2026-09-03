[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Verify', 'InstallDisabled', 'Enable', 'Disable')]
    [string]$Action,

    [Parameter(Mandatory = $true)][string]$NodeExe,
    [Parameter(Mandatory = $true)][string]$BindAddress,
    [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RentProofLanFirewall.Common.ps1')

Assert-RentProofRfc1918Address -Address $BindAddress
$resolvedNode = Resolve-RentProofNodeExecutable -NodeExe $NodeExe
$null = Assert-RentProofPrivateNetworkProfile -BindAddress $BindAddress
$snapshot = Get-RentProofFirewallSnapshot

if ($Action -eq 'Verify') {
    if ($null -eq $snapshot) {
        throw 'LAN_FIREWALL_RULE_MISSING'
    }
    Assert-RentProofFirewallScope -Snapshot $snapshot -NodeExe $resolvedNode -BindAddress $BindAddress -Port $Port
    $snapshot | ConvertTo-Json -Depth 4
    exit 0
}

if (-not $WhatIfPreference) {
    Assert-RentProofAdministrator
}

if ($Action -eq 'InstallDisabled') {
    if ($null -ne $snapshot) {
        Assert-RentProofFirewallScope -Snapshot $snapshot -NodeExe $resolvedNode -BindAddress $BindAddress -Port $Port
        if ($snapshot.enabled) {
            throw 'LAN_FIREWALL_RULE_STALE_ENABLED'
        }
        $snapshot | ConvertTo-Json -Depth 4
        exit 0
    }
    if ($PSCmdlet.ShouldProcess($script:RentProofRuleName, 'Install exact disabled Private-profile inbound rule')) {
        New-NetFirewallRule `
            -Name $script:RentProofRuleName `
            -DisplayName $script:RentProofRuleDisplayName `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalAddress $BindAddress `
            -LocalPort $Port `
            -RemoteAddress LocalSubnet `
            -Profile Private `
            -Program $resolvedNode `
            -Enabled False | Out-Null
    }
} else {
    if ($null -eq $snapshot) {
        throw 'LAN_FIREWALL_RULE_MISSING'
    }
    Assert-RentProofFirewallScope -Snapshot $snapshot -NodeExe $resolvedNode -BindAddress $BindAddress -Port $Port
    # NetSecurity uses a generated enum for Enabled and rejects a Boolean on some
    # Windows builds. Pass the canonical enum-compatible strings explicitly.
    $targetEnabled = if ($Action -eq 'Enable') { 'True' } else { 'False' }
    if ($PSCmdlet.ShouldProcess($script:RentProofRuleName, "Set Enabled=$targetEnabled")) {
        Set-NetFirewallRule -Name $script:RentProofRuleName -Enabled $targetEnabled | Out-Null
    }
}

if ($WhatIfPreference) {
    [pscustomobject]@{
        action = $Action
        ruleName = $script:RentProofRuleName
        whatIf = $true
        nodeExecutable = $resolvedNode
        bindAddress = $BindAddress
        port = $Port
    } | ConvertTo-Json -Depth 4
    exit 0
}

$verified = Get-RentProofFirewallSnapshot
Assert-RentProofFirewallScope -Snapshot $verified -NodeExe $resolvedNode -BindAddress $BindAddress -Port $Port
if ($Action -eq 'Enable' -and -not $verified.enabled) {
    throw 'LAN_FIREWALL_RULE_DISABLED'
}
if (($Action -eq 'Disable' -or $Action -eq 'InstallDisabled') -and $verified.enabled) {
    throw 'LAN_FIREWALL_RULE_STALE_ENABLED'
}
$verified | ConvertTo-Json -Depth 4
