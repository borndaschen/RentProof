[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Verify', 'InstallDisabled', 'Enable', 'Disable')]
    [string]$Action,
    [Parameter(Mandatory = $true)][string]$NodeExe,
    [Parameter(Mandatory = $true)][string]$BindAddress,
    [Parameter(Mandatory = $true)][ValidateRange(1024, 65535)][int]$Port,
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [Parameter(Mandatory = $true)][string]$ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-RentProofResult {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'BLOCKED')][string]$Status,
        [Parameter(Mandatory = $true)][string]$Code,
        [AllowNull()][Nullable[bool]]$Enabled
    )

    if ($Code -notmatch '^LAN_[A-Z0-9_]+$') {
        $Code = 'LAN_FIREWALL_OPERATION_FAILED'
    }
    $payload = [ordered]@{
        schema = 'rentproof.lan-firewall-operation.v1'
        status = $Status
        code = $Code
        action = $Action
    }
    if ($null -ne $Enabled) {
        $payload.enabled = [bool]$Enabled
    }
    $json = ($payload | ConvertTo-Json -Compress -Depth 3)
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    $stream = [IO.File]::Open($ResultPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
}

try {
    $runtime = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\')
    $result = [IO.Path]::GetFullPath($ResultPath)
    $resultDirectory = [IO.Path]::GetDirectoryName($result)
    if (
        -not [IO.Path]::IsPathRooted($runtime) -or
        -not [IO.Path]::IsPathRooted($result) -or
        $runtime.StartsWith('\\') -or
        $result.StartsWith('\\') -or
        -not $result.StartsWith($runtime + '\', [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetExtension($result) -cne '.json' -or
        [IO.File]::Exists($result)
    ) {
        throw 'LAN_FIREWALL_RESULT_PATH_INVALID'
    }
    foreach ($path in @($runtime, $resultDirectory)) {
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'LAN_FIREWALL_RESULT_PATH_INVALID'
        }
    }

    $manager = Join-Path $PSScriptRoot 'Set-RentProofLanFirewallRule.ps1'
    $raw = & $manager -Action $Action -NodeExe $NodeExe -BindAddress $BindAddress -Port $Port | Out-String
    $snapshot = $raw | ConvertFrom-Json -ErrorAction Stop
    $enabled = [bool]$snapshot.enabled
    if ($Action -eq 'Enable' -and -not $enabled) {
        throw 'LAN_FIREWALL_RULE_DISABLED'
    }
    if (($Action -eq 'Disable' -or $Action -eq 'InstallDisabled') -and $enabled) {
        throw 'LAN_FIREWALL_RULE_STALE_ENABLED'
    }
    $code = if ($enabled) { 'LAN_FIREWALL_RULE_ENABLED_VERIFIED' } else { 'LAN_FIREWALL_RULE_DISABLED_VERIFIED' }
    Write-RentProofResult -Status PASS -Code $code -Enabled $enabled
    exit 0
}
catch {
    $code = $_.Exception.Message
    if ($code -notmatch '^LAN_[A-Z0-9_]+$') {
        $code = 'LAN_FIREWALL_OPERATION_FAILED'
    }
    try {
        Write-RentProofResult -Status BLOCKED -Code $code -Enabled $null
    }
    catch {
        # The caller treats a missing or invalid result file as fail-closed.
    }
    exit 1
}
