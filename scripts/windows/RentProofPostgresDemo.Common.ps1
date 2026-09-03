Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RentProofPgPort = 55432
$script:RentProofPgMarkerName = '.rentproof-postgres-demo-owner.json'
$script:RentProofPgMarkerSchema = 'rentproof.postgres-demo-owner.v1'
$script:RentProofPgBin = 'C:\Program Files\PostgreSQL\18\bin'

function Get-RentProofPostgresDemoPaths {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'POSTGRES_DEMO_LOCALAPPDATA_REQUIRED'
    }
    $local = [IO.Path]::GetFullPath($env:LOCALAPPDATA)
    $root = [IO.Path]::GetFullPath((Join-Path $local 'RentProof\postgres-demo'))
    $expected = [IO.Path]::GetFullPath((Join-Path $local 'RentProof\postgres-demo'))
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($root, $expected)) {
        throw 'POSTGRES_DEMO_ROOT_INVALID'
    }
    return [pscustomobject]@{
        Root = $root
        Data = Join-Path $root 'data'
        Log = Join-Path $root 'logs\postgres.log'
        Secrets = Join-Path $root 'cluster.secrets.json'
        AppEnv = Join-Path $root '.env.postgres-demo.local'
        AuthPid = Join-Path $root '.auth-demo-process.json'
        AuthLog = Join-Path $root 'logs\auth-demo.log'
        Marker = Join-Path $root $script:RentProofPgMarkerName
        PgCtl = Join-Path $script:RentProofPgBin 'pg_ctl.exe'
        InitDb = Join-Path $script:RentProofPgBin 'initdb.exe'
        Psql = Join-Path $script:RentProofPgBin 'psql.exe'
    }
}

function Assert-RentProofPostgresDemoVolume {
    param([Parameter(Mandatory)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    $volume = [IO.DriveInfo]::new($root)
    if (-not $volume.IsReady -or $volume.DriveType -ne [IO.DriveType]::Fixed -or $volume.DriveFormat -ne 'NTFS') {
        throw 'POSTGRES_DEMO_FIXED_NTFS_REQUIRED'
    }
    $cursor = $full
    while (-not [string]::IsNullOrEmpty($cursor) -and $cursor.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'POSTGRES_DEMO_REPARSE_FORBIDDEN'
            }
        }
        if ([StringComparer]::OrdinalIgnoreCase.Equals($cursor, $root.TrimEnd('\'))) { break }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Set-RentProofPrivateAcl {
    param(
        [Parameter(Mandatory)][string]$Path,
        [switch]$Directory
    )
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path '/inheritance:r' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_ACL_INHERITANCE_FAILED' }
    if ($Directory) {
        & icacls.exe $Path '/grant:r' "*$sid`:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    } else {
        & icacls.exe $Path '/grant:r' "*$sid`:F" '*S-1-5-18:F' | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_ACL_GRANT_FAILED' }
    Assert-RentProofPrivateAcl -Path $Path
}

function Assert-RentProofPrivateAcl {
    param([Parameter(Mandatory)][string]$Path)
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $null = $allowed.Add($currentSid)
    $null = $allowed.Add('S-1-5-18')
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) { throw 'POSTGRES_DEMO_ACL_INHERITANCE_FORBIDDEN' }
    foreach ($rule in $acl.Access) {
        $ruleSid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if (-not $allowed.Contains($ruleSid) -or $rule.AccessControlType -ne 'Allow') {
            throw 'POSTGRES_DEMO_ACL_PRINCIPAL_FORBIDDEN'
        }
    }
}

function Assert-RentProofPostgresDemoMarker {
    param([Parameter(Mandatory)]$Paths)
    Assert-RentProofPostgresDemoVolume -Path $Paths.Root
    if (-not (Test-Path -LiteralPath $Paths.Marker -PathType Leaf)) {
        throw 'POSTGRES_DEMO_MARKER_MISSING'
    }
    Assert-RentProofPrivateAcl -Path $Paths.Marker
    $marker = Get-Content -LiteralPath $Paths.Marker -Raw -Encoding UTF8 | ConvertFrom-Json
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($marker.schema -ne $script:RentProofPgMarkerSchema -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$marker.root, $Paths.Root) -or
        [int]$marker.port -ne $script:RentProofPgPort -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$marker.ownerSid, $currentSid)) {
        throw 'POSTGRES_DEMO_MARKER_INVALID'
    }
}

function New-RentProofRandomSecret {
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    return [Convert]::ToBase64String($bytes)
}

function New-RentProofBase64UrlSecret {
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Assert-RentProofExactPropertySet {
    param(
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][string[]]$Expected,
        [Parameter(Mandatory)][string]$ErrorCode
    )
    $actual = @($Object.PSObject.Properties.Name | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if ($actual.Count -ne $wanted.Count -or @(Compare-Object -ReferenceObject $wanted -DifferenceObject $actual).Count -ne 0) {
        throw $ErrorCode
    }
}

function Get-RentProofPortListenerCount {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$NetstatLines,
        [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port
    )
    $pattern = ':' + $Port + '\s+\S+\s+LISTENING\s+\d+\s*$'
    return @($NetstatLines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-String -Pattern $pattern).Count
}

function Get-RentProofPostgresDemoSecrets {
    param([Parameter(Mandatory)]$Paths)
    if (-not (Test-Path -LiteralPath $Paths.Secrets -PathType Leaf)) {
        throw 'POSTGRES_DEMO_SECRETS_MISSING'
    }
    Assert-RentProofPrivateAcl -Path $Paths.Secrets
    $secrets = Get-Content -LiteralPath $Paths.Secrets -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-RentProofExactPropertySet -Object $secrets -Expected @('admin', 'migration', 'app', 'authToken') -ErrorCode 'POSTGRES_DEMO_SECRETS_INVALID'
    foreach ($name in @('admin', 'migration', 'app', 'authToken')) {
        if ([string]::IsNullOrWhiteSpace([string]$secrets.$name)) {
            throw 'POSTGRES_DEMO_SECRETS_INVALID'
        }
    }
    foreach ($name in @('admin', 'migration', 'app')) {
        if ([string]$secrets.$name -notmatch '^[A-Za-z0-9+/]{43}=$') {
            throw 'POSTGRES_DEMO_SECRETS_INVALID'
        }
    }
    if ([string]$secrets.authToken -notmatch '^[A-Za-z0-9_-]{43}$') {
        throw 'POSTGRES_DEMO_AUTH_TOKEN_INVALID'
    }
    return $secrets
}

function Update-RentProofPostgresDemoSecrets {
    param([Parameter(Mandatory)]$Paths)
    Assert-RentProofPrivateAcl -Path $Paths.Secrets
    $secrets = Get-Content -LiteralPath $Paths.Secrets -Raw -Encoding UTF8 | ConvertFrom-Json
    $names = @($secrets.PSObject.Properties.Name | Sort-Object)
    $legacyNames = @('admin', 'app', 'migration') | Sort-Object
    $currentNames = @('admin', 'app', 'authToken', 'migration') | Sort-Object
    if ($names.Count -eq $legacyNames.Count -and @(Compare-Object $legacyNames $names).Count -eq 0) {
        $secrets = [ordered]@{
            admin = [string]$secrets.admin
            migration = [string]$secrets.migration
            app = [string]$secrets.app
            authToken = New-RentProofBase64UrlSecret
        }
        $secrets | ConvertTo-Json -Compress | Set-Content -LiteralPath $Paths.Secrets -Encoding UTF8 -NoNewline
        Set-RentProofPrivateAcl -Path $Paths.Secrets
    } elseif ($names.Count -ne $currentNames.Count -or @(Compare-Object $currentNames $names).Count -ne 0) {
        throw 'POSTGRES_DEMO_SECRETS_INVALID'
    }
    return Get-RentProofPostgresDemoSecrets -Paths $Paths
}

function Set-RentProofPostgresDemoAppEnvironment {
    param(
        [Parameter(Mandatory)]$Paths,
        [Parameter(Mandatory)]$Secrets
    )
    $appUrl = 'postgresql://rentproof_demo_app:' + [Uri]::EscapeDataString([string]$Secrets.app) + '@127.0.0.1:' + $script:RentProofPgPort + '/rentproof_demo'
    @(
        'RENTPROOF_DATABASE_ADAPTER=postgres'
        "RENTPROOF_DATABASE_URL=$appUrl"
        'RENTPROOF_DATABASE_ROLE=app'
        'RENTPROOF_DATABASE_ENVIRONMENT=synthetic_demo'
        'RENTPROOF_DATABASE_MAX_CONNECTIONS=4'
        'RENTPROOF_ALLOW_REAL_DATA=false'
        'RENTPROOF_DEPLOYMENT_PROFILE=local_development'
        'RENTPROOF_BIND_HOST=127.0.0.1'
        'RENTPROOF_PORT=3000'
        'RENTPROOF_PUBLIC_ORIGIN=http://127.0.0.1:3000'
        'RENTPROOF_ALLOWED_HOSTS=localhost:3000,127.0.0.1:3000'
        'RENTPROOF_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000'
        'RENTPROOF_AUTH_MODE=self_hosted'
        "RENTPROOF_AUTH_TOKEN_KEY=$([string]$Secrets.authToken)"
        'RENTPROOF_LLM_MODE=fixture'
        'OPENAI_PROJECT_LIMITS_CONFIRMED=false'
        'RENTPROOF_DEMO_CASE_VERSION=golden-v1'
        'OPENAI_CONVERSATION_MODEL=gpt-5.6-luna'
        'OPENAI_CONVERSATION_REASONING_EFFORT=low'
        'OPENAI_EVIDENCE_MODEL=gpt-5.6-terra'
        'OPENAI_EVIDENCE_REASONING_EFFORT=medium'
        'OPENAI_SERVICE_TIER=default'
    ) | Set-Content -LiteralPath $Paths.AppEnv -Encoding UTF8
    Set-RentProofPrivateAcl -Path $Paths.AppEnv
}

function Get-RentProofPostgresDemoAppEnvironment {
    param([Parameter(Mandatory)]$Paths)
    if (-not (Test-Path -LiteralPath $Paths.AppEnv -PathType Leaf)) { throw 'POSTGRES_DEMO_APP_ENV_MISSING' }
    Assert-RentProofPrivateAcl -Path $Paths.AppEnv
    $expected = @(
        'RENTPROOF_DATABASE_ADAPTER', 'RENTPROOF_DATABASE_URL', 'RENTPROOF_DATABASE_ROLE',
        'RENTPROOF_DATABASE_ENVIRONMENT', 'RENTPROOF_DATABASE_MAX_CONNECTIONS', 'RENTPROOF_ALLOW_REAL_DATA',
        'RENTPROOF_DEPLOYMENT_PROFILE', 'RENTPROOF_BIND_HOST', 'RENTPROOF_PORT', 'RENTPROOF_PUBLIC_ORIGIN',
        'RENTPROOF_ALLOWED_HOSTS', 'RENTPROOF_ALLOWED_ORIGINS', 'RENTPROOF_AUTH_MODE', 'RENTPROOF_AUTH_TOKEN_KEY',
        'RENTPROOF_LLM_MODE', 'OPENAI_PROJECT_LIMITS_CONFIRMED', 'RENTPROOF_DEMO_CASE_VERSION',
        'OPENAI_CONVERSATION_MODEL', 'OPENAI_CONVERSATION_REASONING_EFFORT', 'OPENAI_EVIDENCE_MODEL',
        'OPENAI_EVIDENCE_REASONING_EFFORT', 'OPENAI_SERVICE_TIER'
    )
    $values = @{}
    foreach ($line in @(Get-Content -LiteralPath $Paths.AppEnv -Encoding UTF8)) {
        if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') { throw 'POSTGRES_DEMO_APP_ENV_INVALID' }
        $name = $Matches[1]
        if ($values.ContainsKey($name)) { throw 'POSTGRES_DEMO_APP_ENV_INVALID' }
        $values[$name] = $Matches[2]
    }
    Assert-RentProofExactPropertySet -Object ([pscustomobject]$values) -Expected $expected -ErrorCode 'POSTGRES_DEMO_APP_ENV_INVALID'
    if ($values.RENTPROOF_AUTH_MODE -ne 'self_hosted' -or
        $values.RENTPROOF_AUTH_TOKEN_KEY -notmatch '^[A-Za-z0-9_-]{43}$' -or
        $values.RENTPROOF_DATABASE_ADAPTER -ne 'postgres' -or
        $values.RENTPROOF_DATABASE_ROLE -ne 'app' -or
        $values.RENTPROOF_DATABASE_ENVIRONMENT -ne 'synthetic_demo' -or
        $values.RENTPROOF_DATABASE_MAX_CONNECTIONS -ne '4' -or
        $values.RENTPROOF_ALLOW_REAL_DATA -ne 'false' -or
        $values.RENTPROOF_DEPLOYMENT_PROFILE -ne 'local_development' -or
        $values.RENTPROOF_BIND_HOST -ne '127.0.0.1' -or
        $values.RENTPROOF_PORT -ne '3000' -or
        $values.RENTPROOF_PUBLIC_ORIGIN -ne 'http://127.0.0.1:3000' -or
        $values.RENTPROOF_ALLOWED_HOSTS -ne 'localhost:3000,127.0.0.1:3000' -or
        $values.RENTPROOF_ALLOWED_ORIGINS -ne 'http://localhost:3000,http://127.0.0.1:3000' -or
        $values.RENTPROOF_LLM_MODE -ne 'fixture' -or
        $values.OPENAI_PROJECT_LIMITS_CONFIRMED -ne 'false' -or
        $values.RENTPROOF_DEMO_CASE_VERSION -ne 'golden-v1' -or
        $values.OPENAI_CONVERSATION_MODEL -ne 'gpt-5.6-luna' -or
        $values.OPENAI_CONVERSATION_REASONING_EFFORT -ne 'low' -or
        $values.OPENAI_EVIDENCE_MODEL -ne 'gpt-5.6-terra' -or
        $values.OPENAI_EVIDENCE_REASONING_EFFORT -ne 'medium' -or
        $values.OPENAI_SERVICE_TIER -ne 'default') {
        throw 'POSTGRES_DEMO_APP_ENV_INVALID'
    }
    $url = [Uri]$values.RENTPROOF_DATABASE_URL
    if ($url.Scheme -ne 'postgresql' -or $url.Host -ne '127.0.0.1' -or $url.Port -ne $script:RentProofPgPort -or $url.AbsolutePath -ne '/rentproof_demo' -or $url.UserInfo -notmatch '^rentproof_demo_app:.+' -or -not [string]::IsNullOrEmpty($url.Query) -or -not [string]::IsNullOrEmpty($url.Fragment)) {
        throw 'POSTGRES_DEMO_APP_ENV_INVALID'
    }
    return $values
}

function Assert-RentProofPostgresDemoAppEnvironmentMatchesSecrets {
    param(
        [Parameter(Mandatory)]$Values,
        [Parameter(Mandatory)]$Secrets
    )
    $expectedUrl = 'postgresql://rentproof_demo_app:' + [Uri]::EscapeDataString([string]$Secrets.app) + '@127.0.0.1:' + $script:RentProofPgPort + '/rentproof_demo'
    if (-not [StringComparer]::Ordinal.Equals([string]$Values.RENTPROOF_DATABASE_URL, $expectedUrl) -or
        -not [StringComparer]::Ordinal.Equals([string]$Values.RENTPROOF_AUTH_TOKEN_KEY, [string]$Secrets.authToken)) {
        throw 'POSTGRES_DEMO_APP_ENV_SECRET_MISMATCH'
    }
}

function Assert-RentProofAuthProcessStartTime {
    param(
        [Parameter(Mandatory)][string]$MarkerStartedAt,
        [Parameter(Mandatory)][datetime]$ProcessStartedAt,
        [datetime]$UtcNow = [DateTime]::UtcNow
    )
    if ($MarkerStartedAt -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$') {
        throw 'AUTH_DEMO_PROCESS_MARKER_INVALID'
    }
    $markerInstant = [DateTimeOffset]::MinValue
    $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [DateTimeOffset]::TryParseExact($MarkerStartedAt, 'O', [Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$markerInstant)) {
        throw 'AUTH_DEMO_PROCESS_MARKER_INVALID'
    }
    $processInstant = [DateTimeOffset]::new($ProcessStartedAt.ToUniversalTime())
    $nowInstant = [DateTimeOffset]::new($UtcNow.ToUniversalTime())
    if ($markerInstant -gt $nowInstant -or $processInstant -gt $nowInstant) {
        throw 'AUTH_DEMO_PROCESS_MARKER_INVALID'
    }
    if ([Math]::Abs(($markerInstant - $processInstant).TotalMilliseconds) -gt 1000) {
        throw 'AUTH_DEMO_PROCESS_MISMATCH'
    }
}

function Assert-RentProofPostmasterContainment {
    param([Parameter(Mandatory)]$Paths)
    $pidFile = Join-Path $Paths.Data 'postmaster.pid'
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return $null }
    $rpPostmasterPid = Assert-RentProofPostmasterPidMetadata -Paths $Paths -Lines @(Get-Content -LiteralPath $pidFile -Encoding UTF8)
    $process = Get-Process -Id $rpPostmasterPid -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    $expected = [IO.Path]::GetFullPath((Join-Path $script:RentProofPgBin 'postgres.exe'))
    if ([string]::IsNullOrWhiteSpace($process.Path) -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($process.Path), $expected)) {
        throw 'POSTGRES_DEMO_PID_PROCESS_MISMATCH'
    }
    return $process
}

function Assert-RentProofPostmasterPidMetadata {
    param(
        [Parameter(Mandatory)]$Paths,
        [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Lines
    )
    if ($Lines.Count -lt 8) { throw 'POSTGRES_DEMO_PID_METADATA_INVALID' }
    $pidLine = $Lines[0].Trim()
    if ($pidLine -notmatch '^\d+$') { throw 'POSTGRES_DEMO_PID_INVALID' }
    $recordedData = [IO.Path]::GetFullPath($Lines[1].Trim())
    $expectedData = [IO.Path]::GetFullPath($Paths.Data)
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($recordedData, $expectedData)) {
        throw 'POSTGRES_DEMO_PID_DATA_ROOT_MISMATCH'
    }
    if ($Lines[3].Trim() -ne "$script:RentProofPgPort") {
        throw 'POSTGRES_DEMO_PID_PORT_MISMATCH'
    }
    $addresses = @($Lines[5].Split(',', [StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object { $_.Trim() })
    $allowedAddresses = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $null = $allowedAddresses.Add('127.0.0.1')
    $null = $allowedAddresses.Add('::1')
    if ($addresses.Count -eq 0 -or
        -not $addresses.Contains('127.0.0.1') -or
        @($addresses | Where-Object { -not $allowedAddresses.Contains($_) }).Count -gt 0) {
        throw 'POSTGRES_DEMO_PID_LISTEN_ADDRESS_MISMATCH'
    }
    if ($Lines[7].Trim() -ne 'ready') {
        throw 'POSTGRES_DEMO_PID_STATUS_NOT_READY'
    }
    return [int]$pidLine
}

function Assert-RentProofNoReparseTree {
    param([Parameter(Mandatory)][string]$Root)
    $pending = [Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($Root)
    while ($pending.Count -gt 0) {
        $current = $pending.Dequeue()
        foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
            if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'POSTGRES_DEMO_REPARSE_FORBIDDEN'
            }
            if ($child.PSIsContainer) { $pending.Enqueue($child.FullName) }
        }
    }
}

function Invoke-RentProofPsqlFile {
    param(
        [Parameter(Mandatory)]$Paths,
        [Parameter(Mandatory)][string]$User,
        [Parameter(Mandatory)][string]$Database,
        [Parameter(Mandatory)][string]$Password,
        [Parameter(Mandatory)][string]$SqlFile
    )
    $previous = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $Password
        & $Paths.Psql '-X' '-q' '-v' 'ON_ERROR_STOP=1' '-h' '127.0.0.1' '-p' "$script:RentProofPgPort" '-U' $User '-d' $Database '-f' $SqlFile *> $null
        if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_PSQL_FAILED' }
    } finally {
        if ($null -eq $previous) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previous }
    }
}

function Invoke-RentProofDetachedCommand {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$ArgumentList,
        [Parameter(Mandatory)][string]$StandardOutputPath,
        [Parameter(Mandatory)][string]$StandardErrorPath
    )
    $rpProcess = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -RedirectStandardOutput $StandardOutputPath -RedirectStandardError $StandardErrorPath -WindowStyle Hidden -PassThru
    if (-not $rpProcess.WaitForExit(30000)) {
        try { $rpProcess.Kill() } catch { }
        throw 'POSTGRES_DEMO_LAUNCHER_TIMEOUT'
    }
    $rpProcess.Refresh()
    return $rpProcess.ExitCode
}
