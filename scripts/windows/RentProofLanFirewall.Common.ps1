Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RentProofRuleName = 'RentProof-Lan-Secure-Demo-Managed'
$script:RentProofRuleDisplayName = 'RentProof LAN HTTPS Demo (Managed)'

function Assert-RentProofRfc1918Address {
    param([Parameter(Mandatory = $true)][string]$Address)

    if ($Address -notmatch '^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$') {
        throw 'LAN_BIND_UNSAFE'
    }
    $parsed = [System.Net.IPAddress]::Parse($Address)
    if ($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
        throw 'LAN_BIND_UNSAFE'
    }
    $octets = $parsed.GetAddressBytes()
    $private =
        $octets[0] -eq 10 -or
        ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or
        ($octets[0] -eq 192 -and $octets[1] -eq 168)
    if (-not $private) {
        throw 'LAN_BIND_UNSAFE'
    }
}

function Resolve-RentProofNodeExecutable {
    param([Parameter(Mandatory = $true)][string]$NodeExe)

    if (-not [System.IO.Path]::IsPathRooted($NodeExe) -or $NodeExe.StartsWith('\\')) {
        throw 'LAN_NODE_EXECUTABLE_UNSAFE'
    }
    $resolved = (Resolve-Path -LiteralPath $NodeExe -ErrorAction Stop).Path
    $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and $item.Name -ieq 'node.exe' -and $item.PSProvider.Name -eq 'FileSystem') {
        return $item.FullName
    }
    throw 'LAN_NODE_EXECUTABLE_UNSAFE'
}

function Assert-RentProofPrivateNetworkProfile {
    param([Parameter(Mandatory = $true)][string]$BindAddress)

    $ip = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $BindAddress -ErrorAction Stop)
    if ($ip.Count -ne 1) {
        throw 'LAN_BIND_UNSAFE'
    }
    $profile = Get-NetConnectionProfile -InterfaceIndex $ip[0].InterfaceIndex -ErrorAction Stop
    if ($profile.NetworkCategory.ToString() -ne 'Private') {
        throw 'LAN_NETWORK_PROFILE_NOT_PRIVATE'
    }
    return $profile
}

function Get-RentProofFirewallSnapshot {
    $rules = @(Get-NetFirewallRule -Name $script:RentProofRuleName -ErrorAction SilentlyContinue)
    if ($rules.Count -eq 0) {
        return $null
    }
    if ($rules.Count -ne 1) {
        throw 'LAN_FIREWALL_RULE_SCOPE_INVALID'
    }
    $rule = $rules[0]
    $application = @(Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule)
    $address = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule)
    $port = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule)
    if ($application.Count -ne 1 -or $address.Count -ne 1 -or $port.Count -ne 1) {
        throw 'LAN_FIREWALL_RULE_SCOPE_INVALID'
    }
    [pscustomobject]@{
        ruleName = $rule.Name
        displayName = $rule.DisplayName
        direction = $rule.Direction.ToString()
        action = $rule.Action.ToString()
        protocol = $port[0].Protocol.ToString()
        localAddress = (@($address[0].LocalAddress) -join ',')
        localPort = [int]$port[0].LocalPort
        remoteAddress = (@($address[0].RemoteAddress) -join ',')
        profiles = @($rule.Profile.ToString())
        programPath = $application[0].Program
        enabled = $rule.Enabled.ToString() -eq 'True'
    }
}

function Assert-RentProofFirewallScope {
    param(
        [Parameter(Mandatory = $true)]$Snapshot,
        [Parameter(Mandatory = $true)][string]$NodeExe,
        [Parameter(Mandatory = $true)][string]$BindAddress,
        [Parameter(Mandatory = $true)][int]$Port
    )

    if (
        $null -eq $Snapshot -or
        $Snapshot.ruleName -cne $script:RentProofRuleName -or
        $Snapshot.displayName -cne $script:RentProofRuleDisplayName -or
        $Snapshot.direction -cne 'Inbound' -or
        $Snapshot.action -cne 'Allow' -or
        $Snapshot.protocol -cne 'TCP' -or
        $Snapshot.localAddress -cne $BindAddress -or
        $Snapshot.localPort -ne $Port -or
        $Snapshot.remoteAddress -cne 'LocalSubnet' -or
        $Snapshot.profiles.Count -ne 1 -or
        $Snapshot.profiles[0] -cne 'Private' -or
        [System.IO.Path]::GetFullPath($Snapshot.programPath) -ine [System.IO.Path]::GetFullPath($NodeExe)
    ) {
        throw 'LAN_FIREWALL_RULE_SCOPE_INVALID'
    }
}

function Assert-RentProofAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'ADMINISTRATOR_REQUIRED'
    }
}
