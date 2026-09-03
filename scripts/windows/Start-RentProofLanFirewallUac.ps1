[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Verify', 'InstallDisabled', 'Enable', 'Disable')]
    [string]$Action,
    [Parameter(Mandatory = $true)][string]$NodeExe,
    [Parameter(Mandatory = $true)][string]$BindAddress,
    [Parameter(Mandatory = $true)][ValidateRange(1024, 65535)][int]$Port,
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [ValidateRange(5, 120)][int]$TimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Quote-PowerShellLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)
    if ($Value.Contains("`r") -or $Value.Contains("`n") -or $Value.Contains([char]0)) {
        throw 'LAN_FIREWALL_UAC_ARGUMENT_INVALID'
    }
    return "'" + $Value.Replace("'", "''") + "'"
}

try {
    $elevatedScript = Join-Path $PSScriptRoot 'Invoke-RentProofLanFirewallElevated.ps1'
    $command = @(
        '&',
        (Quote-PowerShellLiteral $elevatedScript),
        '-Action',
        (Quote-PowerShellLiteral $Action),
        '-NodeExe',
        (Quote-PowerShellLiteral $NodeExe),
        '-BindAddress',
        (Quote-PowerShellLiteral $BindAddress),
        '-Port',
        [string]$Port,
        '-RuntimeRoot',
        (Quote-PowerShellLiteral $RuntimeRoot),
        '-ResultPath',
        (Quote-PowerShellLiteral $ResultPath)
    ) -join ' '
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $arguments = @(
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        $encodedCommand
    )
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -PassThru
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try {
            $process.Kill()
            $process.WaitForExit(5000) | Out-Null
        }
        catch {
            [pscustomobject]@{ status = 'BLOCKED'; code = 'LAN_FIREWALL_UAC_TIMEOUT_CLEANUP_FAILED' } | ConvertTo-Json -Compress
            exit 1
        }
        [pscustomobject]@{ status = 'BLOCKED'; code = 'LAN_FIREWALL_UAC_TIMEOUT' } | ConvertTo-Json -Compress
        exit 1
    }
    [pscustomobject]@{
        status = if ($process.ExitCode -eq 0) { 'PASS' } else { 'BLOCKED' }
        code = if ($process.ExitCode -eq 0) { 'LAN_FIREWALL_UAC_PROCESS_COMPLETED' } else { 'LAN_FIREWALL_UAC_PROCESS_FAILED' }
    } | ConvertTo-Json -Compress
    exit $process.ExitCode
}
catch {
    $code = if (
        $_.Exception.Message -match 'canceled|cancelled|operation was canceled|1223' -or
        $_.FullyQualifiedErrorId -match 'UserCancelled'
    ) { 'LAN_FIREWALL_UAC_CANCELLED_OR_DENIED' } else { 'LAN_FIREWALL_UAC_START_FAILED' }
    [pscustomobject]@{ status = 'BLOCKED'; code = $code } | ConvertTo-Json -Compress
    exit 1
}
