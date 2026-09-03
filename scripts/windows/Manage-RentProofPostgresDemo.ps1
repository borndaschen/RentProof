[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Plan', 'Initialize', 'Start', 'Stop', 'Status', 'Provision', 'MigrationReadiness', 'Migrate', 'Finalize', 'Readiness', 'Smoke', 'StartAuthDemo', 'StopAuthDemo', 'StatusAuthDemo', 'AuthHttpSmoke', 'AuthHttpResidueCheck', 'Uninstall')]
    [string]$Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'RentProofPostgresDemo.Common.ps1')

$paths = Get-RentProofPostgresDemoPaths
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$nodeExe = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { throw 'POSTGRES_DEMO_NODE24_MISSING' }
$nodeVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($nodeExe)
if ($nodeVersion.FileMajorPart -ne 24) { throw 'POSTGRES_DEMO_NODE24_REQUIRED' }

function Write-SafeStatus([string]$Code) { Write-Output $Code }

function Initialize-Cluster {
    Assert-RentProofPostgresDemoVolume -Path $paths.Root
    if (Test-Path -LiteralPath $paths.Root) {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        if (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION')) {
            $version = (Get-Content -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -Raw -Encoding ASCII).Trim()
            if ($version -ne '18') { throw 'POSTGRES_DEMO_VERSION_INVALID' }
            $secrets = Update-RentProofPostgresDemoSecrets -Paths $paths
            Set-RentProofPostgresDemoAppEnvironment -Paths $paths -Secrets $secrets
            $null = Get-RentProofPostgresDemoAppEnvironment -Paths $paths
            Write-SafeStatus 'POSTGRES_DEMO_ALREADY_INITIALIZED'
            return
        }
    } else {
        New-Item -ItemType Directory -Path $paths.Root | Out-Null
        Set-RentProofPrivateAcl -Path $paths.Root -Directory
        $marker = [ordered]@{
            schema = $script:RentProofPgMarkerSchema
            root = $paths.Root
            port = $script:RentProofPgPort
            ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        } | ConvertTo-Json -Compress
        Set-Content -LiteralPath $paths.Marker -Value $marker -Encoding UTF8 -NoNewline
        Set-RentProofPrivateAcl -Path $paths.Marker
    }
    foreach ($binary in @($paths.InitDb, $paths.PgCtl, $paths.Psql)) {
        if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'POSTGRES_DEMO_PG18_BINARY_MISSING' }
    }
    $secrets = [ordered]@{
        admin = New-RentProofRandomSecret
        migration = New-RentProofRandomSecret
        app = New-RentProofRandomSecret
        authToken = New-RentProofBase64UrlSecret
    }
    $secrets | ConvertTo-Json -Compress | Set-Content -LiteralPath $paths.Secrets -Encoding UTF8 -NoNewline
    Set-RentProofPrivateAcl -Path $paths.Secrets
    $pwFile = Join-Path $paths.Root '.initdb.pw'
    try {
        Set-Content -LiteralPath $pwFile -Value $secrets.admin -Encoding ASCII -NoNewline
        Set-RentProofPrivateAcl -Path $pwFile
        & $paths.InitDb '-D' $paths.Data '-U' 'rentproof_demo_admin' '--pwfile' $pwFile '--auth-host=scram-sha-256' '--auth-local=scram-sha-256' '--encoding=UTF8' '--no-instructions' *> $null
        if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_INITDB_FAILED' }
    } finally {
        if (Test-Path -LiteralPath $pwFile) { Remove-Item -LiteralPath $pwFile -Force }
    }
    Add-Content -LiteralPath (Join-Path $paths.Data 'postgresql.conf') -Encoding UTF8 -Value @"

# RentProof Synthetic Demo managed settings
listen_addresses = '127.0.0.1,::1'
port = $script:RentProofPgPort
password_encryption = 'scram-sha-256'
max_connections = 20
shared_buffers = '128MB'
log_connections = on
log_disconnections = on
logging_collector = off
"@
    Set-Content -LiteralPath (Join-Path $paths.Data 'pg_hba.conf') -Encoding ASCII -Value @'
# RentProof Synthetic Demo: loopback and SCRAM only.
host all all 127.0.0.1/32 scram-sha-256
host all all ::1/128 scram-sha-256
'@
    Set-RentProofPostgresDemoAppEnvironment -Paths $paths -Secrets $secrets
    Write-SafeStatus 'POSTGRES_DEMO_INITIALIZED'
}

function Start-Cluster {
    Assert-RentProofPostgresDemoMarker -Paths $paths
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) { throw 'POSTGRES_DEMO_DATA_MISSING' }
    $running = Assert-RentProofPostmasterContainment -Paths $paths
    if ($null -ne $running) { Write-SafeStatus 'POSTGRES_DEMO_ALREADY_RUNNING'; return }
    $listenerCount = Get-RentProofPortListenerCount -NetstatLines @(& netstat.exe -ano) -Port $script:RentProofPgPort
    if ($listenerCount -gt 0) {
        throw 'POSTGRES_DEMO_PORT_CONFLICT'
    }
    $logDirectory = Split-Path -Parent $paths.Log
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Set-RentProofPrivateAcl -Path $logDirectory -Directory
    $pgCtlOutput = Join-Path $logDirectory 'pgctl-start.stdout.log'
    $pgCtlError = Join-Path $logDirectory 'pgctl-start.stderr.log'
    $startExitCode = Invoke-RentProofDetachedCommand -FilePath $paths.PgCtl -ArgumentList @('-D', $paths.Data, '-l', $paths.Log, '-w', '-t', '20', 'start') -StandardOutputPath $pgCtlOutput -StandardErrorPath $pgCtlError
    if ($startExitCode -ne 0) { throw 'POSTGRES_DEMO_START_FAILED' }
    Set-RentProofPrivateAcl -Path $pgCtlOutput
    Set-RentProofPrivateAcl -Path $pgCtlError
    $null = Assert-RentProofPostmasterContainment -Paths $paths
    & $nodeExe (Join-Path $repoRoot 'scripts\postgres-listener-check.mts') "$script:RentProofPgPort"
    if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_LISTENER_GATE_FAILED' }
    Write-SafeStatus 'POSTGRES_DEMO_STARTED'
}

function Stop-Cluster {
    Assert-RentProofPostgresDemoMarker -Paths $paths
    $running = Assert-RentProofPostmasterContainment -Paths $paths
    if ($null -eq $running) { Write-SafeStatus 'POSTGRES_DEMO_ALREADY_STOPPED'; return }
    & $paths.PgCtl '-D' $paths.Data '-w' '-t' '20' 'stop' '-m' 'fast' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_STOP_FAILED' }
    Write-SafeStatus 'POSTGRES_DEMO_STOPPED'
}

function New-ProvisionSql {
    param([Parameter(Mandatory)]$Secrets)
    $file = Join-Path $paths.Root '.provision.sql'
    $migration = ([string]$Secrets.migration).Replace("'", "''")
    $app = ([string]$Secrets.app).Replace("'", "''")
    @"
\set ON_ERROR_STOP on
\set QUIET on
SELECT 'CREATE ROLE rentproof_demo_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rentproof_demo_owner') \gexec
SELECT 'CREATE ROLE rentproof_demo_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rentproof_demo_migration') \gexec
SELECT 'CREATE ROLE rentproof_demo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rentproof_demo_app') \gexec
SELECT format('ALTER ROLE rentproof_demo_migration PASSWORD %L', '$migration') \gexec
SELECT format('ALTER ROLE rentproof_demo_app PASSWORD %L', '$app') \gexec
SELECT 'CREATE DATABASE rentproof_demo OWNER rentproof_demo_owner ENCODING ''UTF8'' TEMPLATE template0' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='rentproof_demo') \gexec
\connect rentproof_demo
REVOKE ALL ON DATABASE rentproof_demo FROM PUBLIC;
GRANT CONNECT ON DATABASE rentproof_demo TO rentproof_demo_migration, rentproof_demo_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS rentproof AUTHORIZATION rentproof_demo_migration;
ALTER SCHEMA rentproof OWNER TO rentproof_demo_migration;
REVOKE ALL ON SCHEMA rentproof FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA rentproof TO rentproof_demo_migration;
GRANT USAGE ON SCHEMA rentproof TO rentproof_demo_app;
ALTER ROLE rentproof_demo_migration IN DATABASE rentproof_demo SET search_path=rentproof,pg_catalog;
ALTER ROLE rentproof_demo_app IN DATABASE rentproof_demo SET search_path=rentproof,pg_catalog;
ALTER ROLE rentproof_demo_migration IN DATABASE rentproof_demo SET statement_timeout='30s';
ALTER ROLE rentproof_demo_app IN DATABASE rentproof_demo SET statement_timeout='10s';
ALTER ROLE rentproof_demo_migration IN DATABASE rentproof_demo SET idle_in_transaction_session_timeout='15s';
ALTER ROLE rentproof_demo_app IN DATABASE rentproof_demo SET idle_in_transaction_session_timeout='10s';
ALTER DEFAULT PRIVILEGES FOR ROLE rentproof_demo_migration IN SCHEMA rentproof GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO rentproof_demo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rentproof_demo_migration IN SCHEMA rentproof GRANT USAGE,SELECT ON SEQUENCES TO rentproof_demo_app;
"@ | Set-Content -LiteralPath $file -Encoding UTF8
    Set-RentProofPrivateAcl -Path $file
    return $file
}

function Use-DatabaseEnvironment {
    param([Parameter(Mandatory)][string]$Role, [Parameter(Mandatory)][string]$Password)
    $env:RENTPROOF_DATABASE_ADAPTER = 'postgres'
    $env:RENTPROOF_DATABASE_URL = 'postgresql://' + $Role + ':' + [Uri]::EscapeDataString($Password) + '@127.0.0.1:' + $script:RentProofPgPort + '/rentproof_demo'
    $env:RENTPROOF_DATABASE_ROLE = if ($Role -eq 'rentproof_demo_migration') { 'migration' } else { 'app' }
    $env:RENTPROOF_DATABASE_ENVIRONMENT = 'synthetic_demo'
    $env:RENTPROOF_DATABASE_MAX_CONNECTIONS = '1'
    $env:RENTPROOF_DEPLOYMENT_PROFILE = 'local_development'
    $env:RENTPROOF_ALLOW_REAL_DATA = 'false'
    $env:RENTPROOF_PUBLIC_ORIGIN = 'http://127.0.0.1:3000'
}

function Assert-AuthDemoStandardUser {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'AUTH_DEMO_ELEVATED_PROCESS_FORBIDDEN'
    }
}

function Get-AuthDemoProcess {
    if (-not (Test-Path -LiteralPath $paths.AuthPid -PathType Leaf)) { return $null }
    Assert-RentProofPrivateAcl -Path $paths.AuthPid
    $markerRaw = Get-Content -LiteralPath $paths.AuthPid -Raw -Encoding UTF8
    $marker = $markerRaw | ConvertFrom-Json
    $markerDocument = [Text.Json.JsonDocument]::Parse($markerRaw)
    try {
        if (@($markerDocument.RootElement.EnumerateObject()).Count -ne 6) { throw 'AUTH_DEMO_PROCESS_MARKER_INVALID' }
        $startedAtElement = $markerDocument.RootElement.GetProperty('startedAt')
        if ($startedAtElement.ValueKind -ne [Text.Json.JsonValueKind]::String) { throw 'AUTH_DEMO_PROCESS_MARKER_INVALID' }
        $markerStartedAt = $startedAtElement.GetString()
    } finally {
        $markerDocument.Dispose()
    }
    Assert-RentProofExactPropertySet -Object $marker -Expected @('schema', 'pid', 'startedAt', 'nodePath', 'repoRoot', 'port') -ErrorCode 'AUTH_DEMO_PROCESS_MARKER_INVALID'
    if ($marker.schema -ne 'rentproof.auth-demo-process.v1' -or
        [int]$marker.port -ne 3000 -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$marker.nodePath), $nodeExe) -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$marker.repoRoot), $repoRoot)) {
        throw 'AUTH_DEMO_PROCESS_MARKER_INVALID'
    }
    $process = Get-Process -Id ([int]$marker.pid) -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    if ([string]::IsNullOrWhiteSpace($process.Path) -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($process.Path), $nodeExe)) {
        throw 'AUTH_DEMO_PROCESS_MISMATCH'
    }
    Assert-RentProofAuthProcessStartTime -MarkerStartedAt $markerStartedAt -ProcessStartedAt $process.StartTime
    return $process
}

function Remove-StaleAuthDemoMarker {
    if (Test-Path -LiteralPath $paths.AuthPid -PathType Leaf) {
        $process = Get-AuthDemoProcess
        if ($null -eq $process) { Remove-Item -LiteralPath $paths.AuthPid -Force }
    }
}

function Test-AuthDemoHealth {
    try {
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/runtime-status' -Method Get -TimeoutSec 3
        return $status.schemaVersion -eq 'rentproof.runtime-status.v1' -and
            $status.deploymentProfile -eq 'local_development' -and
            $status.dataPolicy -eq 'synthetic_only' -and
            $status.authMode -eq 'self_hosted_local'
    } catch { return $false }
}

function Start-AuthDemo {
    Assert-AuthDemoStandardUser
    Assert-RentProofPostgresDemoMarker -Paths $paths
    if ($null -eq (Assert-RentProofPostmasterContainment -Paths $paths)) { throw 'POSTGRES_DEMO_NOT_RUNNING' }
    Remove-StaleAuthDemoMarker
    if ($null -ne (Get-AuthDemoProcess)) { Write-SafeStatus 'AUTH_DEMO_ALREADY_RUNNING'; return }
    if (Get-RentProofPortListenerCount -NetstatLines @(& netstat.exe -ano) -Port 3000) { throw 'AUTH_DEMO_PORT_CONFLICT' }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.next\BUILD_ID') -PathType Leaf)) { throw 'AUTH_DEMO_PRODUCTION_BUILD_REQUIRED' }
    $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
    $appEnvironment = Get-RentProofPostgresDemoAppEnvironment -Paths $paths
    Assert-RentProofPostgresDemoAppEnvironmentMatchesSecrets -Values $appEnvironment -Secrets $secrets
    foreach ($entry in $appEnvironment.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value ([string]$entry.Value) }
    & $nodeExe (Join-Path $repoRoot 'scripts\postgres-readiness.mts') 'app'
    if ($LASTEXITCODE -ne 0) { throw 'AUTH_DEMO_DATABASE_NOT_READY' }

    $logDirectory = Split-Path -Parent $paths.AuthLog
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Set-RentProofPrivateAcl -Path $logDirectory -Directory
    $errorLog = Join-Path $logDirectory 'auth-demo.stderr.log'
    $startEnvironment = @{}
    foreach ($entry in $appEnvironment.GetEnumerator()) { $startEnvironment[$entry.Key] = [string]$entry.Value }
    $startEnvironment.OPENAI_API_KEY = ''
    foreach ($legacyKey in @('CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'RENTPROOF_CLERK_FRONTEND_ORIGIN')) { $startEnvironment[$legacyKey] = '' }
    $process = Start-Process -FilePath $nodeExe -ArgumentList @((Join-Path $repoRoot 'scripts\run-next.mjs'), 'start') -WorkingDirectory $repoRoot -RedirectStandardOutput $paths.AuthLog -RedirectStandardError $errorLog -WindowStyle Hidden -Environment $startEnvironment -PassThru
    $marker = [ordered]@{
        schema = 'rentproof.auth-demo-process.v1'
        pid = $process.Id
        startedAt = $process.StartTime.ToUniversalTime().ToString('O')
        nodePath = $nodeExe
        repoRoot = $repoRoot
        port = 3000
    } | ConvertTo-Json -Compress
    Set-Content -LiteralPath $paths.AuthPid -Value $marker -Encoding UTF8 -NoNewline
    Set-RentProofPrivateAcl -Path $paths.AuthPid
    Set-RentProofPrivateAcl -Path $paths.AuthLog
    Set-RentProofPrivateAcl -Path $errorLog
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-AuthDemoHealth) { Write-SafeStatus 'AUTH_DEMO_STARTED'; return }
        if ($process.HasExited) { break }
    }
    if (-not $process.HasExited) { & taskkill.exe '/PID' "$($process.Id)" '/T' '/F' *> $null }
    Remove-Item -LiteralPath $paths.AuthPid -Force -ErrorAction SilentlyContinue
    throw 'AUTH_DEMO_START_FAILED'
}

function Stop-AuthDemo {
    Assert-RentProofPostgresDemoMarker -Paths $paths
    $process = Get-AuthDemoProcess
    if ($null -eq $process) {
        Remove-Item -LiteralPath $paths.AuthPid -Force -ErrorAction SilentlyContinue
        Write-SafeStatus 'AUTH_DEMO_ALREADY_STOPPED'
        return
    }
    & taskkill.exe '/PID' "$($process.Id)" '/T' '/F' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'AUTH_DEMO_STOP_FAILED' }
    $process.WaitForExit(10000) | Out-Null
    if (Get-RentProofPortListenerCount -NetstatLines @(& netstat.exe -ano) -Port 3000) { throw 'AUTH_DEMO_PORT_STILL_LISTENING' }
    Remove-Item -LiteralPath $paths.AuthPid -Force
    Write-SafeStatus 'AUTH_DEMO_STOPPED'
}

switch ($Action) {
    'Plan' {
        Assert-RentProofPostgresDemoVolume -Path $paths.Root
        [pscustomobject]@{ root = $paths.Root; port = $script:RentProofPgPort; binaries = $script:RentProofPgBin } | ConvertTo-Json -Compress
    }
    'Initialize' { Initialize-Cluster }
    'Start' { Start-Cluster }
    'Stop' { Stop-Cluster }
    'Status' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        $running = Assert-RentProofPostmasterContainment -Paths $paths
        if ($null -eq $running) { Write-SafeStatus 'POSTGRES_DEMO_STOPPED' } else { Write-SafeStatus 'POSTGRES_DEMO_RUNNING' }
    }
    'Provision' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        if ($null -eq (Assert-RentProofPostmasterContainment -Paths $paths)) { throw 'POSTGRES_DEMO_NOT_RUNNING' }
        $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
        $sql = New-ProvisionSql -Secrets $secrets
        try { Invoke-RentProofPsqlFile -Paths $paths -User 'rentproof_demo_admin' -Database 'postgres' -Password $secrets.admin -SqlFile $sql } finally { Remove-Item -LiteralPath $sql -Force -ErrorAction SilentlyContinue }
        Write-SafeStatus 'POSTGRES_DEMO_PROVISIONED'
    }
    'MigrationReadiness' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        if ($null -eq (Assert-RentProofPostmasterContainment -Paths $paths)) { throw 'POSTGRES_DEMO_NOT_RUNNING' }
        $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
        Use-DatabaseEnvironment -Role 'rentproof_demo_migration' -Password $secrets.migration
        & $nodeExe (Join-Path $repoRoot 'scripts\postgres-readiness.mts') 'migration'
        if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_MIGRATION_READINESS_FAILED' }
        Write-SafeStatus 'POSTGRES_DEMO_MIGRATION_READY'
    }
    'Migrate' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
        Use-DatabaseEnvironment -Role 'rentproof_demo_migration' -Password $secrets.migration
        & $nodeExe (Join-Path $repoRoot 'scripts\postgres-readiness.mts') 'migration'
        if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_MIGRATION_READINESS_FAILED' }
        & $nodeExe (Join-Path $repoRoot 'scripts\postgres-migrate.mts') 'up'
        if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_MIGRATION_FAILED' }
        Write-SafeStatus 'POSTGRES_DEMO_MIGRATED'
    }
    'Finalize' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
        Invoke-RentProofPsqlFile -Paths $paths -User 'rentproof_demo_migration' -Database 'rentproof_demo' -Password $secrets.migration -SqlFile (Join-Path $repoRoot 'scripts\postgres-demo-finalize.sql')
        Write-SafeStatus 'POSTGRES_DEMO_FINALIZED'
    }
    'Readiness' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        if ($null -eq (Assert-RentProofPostmasterContainment -Paths $paths)) { throw 'POSTGRES_DEMO_NOT_RUNNING' }
        $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
        Use-DatabaseEnvironment -Role 'rentproof_demo_app' -Password $secrets.app
        & $nodeExe (Join-Path $repoRoot 'scripts\postgres-readiness.mts') 'app'
        if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_APP_READINESS_FAILED' }
    }
    'Smoke' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        if ($null -eq (Assert-RentProofPostmasterContainment -Paths $paths)) { throw 'POSTGRES_DEMO_NOT_RUNNING' }
        $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
        Use-DatabaseEnvironment -Role 'rentproof_demo_app' -Password $secrets.app
        & $nodeExe (Join-Path $repoRoot 'scripts\postgres-readiness.mts') 'app'
        if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_APP_READINESS_FAILED' }
        & $nodeExe (Join-Path $repoRoot 'scripts\postgres-synthetic-smoke.mts')
        if ($LASTEXITCODE -ne 0) { throw 'POSTGRES_DEMO_SYNTHETIC_SMOKE_FAILED' }
    }
    'StartAuthDemo' { Start-AuthDemo }
    'StopAuthDemo' { Stop-AuthDemo }
    'StatusAuthDemo' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        $process = Get-AuthDemoProcess
        if ($null -eq $process) {
            Remove-Item -LiteralPath $paths.AuthPid -Force -ErrorAction SilentlyContinue
            Write-SafeStatus 'AUTH_DEMO_STOPPED'
        } elseif (Test-AuthDemoHealth) {
            Write-SafeStatus 'AUTH_DEMO_RUNNING'
        } else {
            throw 'AUTH_DEMO_UNHEALTHY'
        }
    }
    'AuthHttpSmoke' {
        Assert-AuthDemoStandardUser
        Assert-RentProofPostgresDemoMarker -Paths $paths
        if ($null -eq (Assert-RentProofPostmasterContainment -Paths $paths)) { throw 'POSTGRES_DEMO_NOT_RUNNING' }
        if ($null -eq (Get-AuthDemoProcess) -or -not (Test-AuthDemoHealth)) { throw 'AUTH_DEMO_UNHEALTHY' }
        $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
        $appEnvironment = Get-RentProofPostgresDemoAppEnvironment -Paths $paths
        Assert-RentProofPostgresDemoAppEnvironmentMatchesSecrets -Values $appEnvironment -Secrets $secrets
        foreach ($entry in $appEnvironment.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value ([string]$entry.Value) }
        & $nodeExe (Join-Path $repoRoot 'scripts\postgres-readiness.mts') 'app'
        if ($LASTEXITCODE -ne 0) { throw 'AUTH_DEMO_DATABASE_NOT_READY' }
        & $nodeExe (Join-Path $repoRoot 'scripts\auth-http-synthetic-smoke.mts')
        if ($LASTEXITCODE -ne 0) { throw 'AUTH_DEMO_HTTP_SMOKE_FAILED' }
    }
    'AuthHttpResidueCheck' {
        Assert-AuthDemoStandardUser
        Assert-RentProofPostgresDemoMarker -Paths $paths
        if ($null -eq (Assert-RentProofPostmasterContainment -Paths $paths)) { throw 'POSTGRES_DEMO_NOT_RUNNING' }
        $secrets = Get-RentProofPostgresDemoSecrets -Paths $paths
        $appEnvironment = Get-RentProofPostgresDemoAppEnvironment -Paths $paths
        Assert-RentProofPostgresDemoAppEnvironmentMatchesSecrets -Values $appEnvironment -Secrets $secrets
        foreach ($entry in $appEnvironment.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value ([string]$entry.Value) }
        & $nodeExe (Join-Path $repoRoot 'scripts\auth-http-synthetic-residue-check.mts')
        if ($LASTEXITCODE -ne 0) { throw 'AUTH_DEMO_HTTP_RESIDUE_CHECK_FAILED' }
    }
    'Uninstall' {
        Assert-RentProofPostgresDemoMarker -Paths $paths
        if ($null -ne (Get-AuthDemoProcess)) { throw 'AUTH_DEMO_STOP_BEFORE_UNINSTALL' }
        if ($null -ne (Assert-RentProofPostmasterContainment -Paths $paths)) { throw 'POSTGRES_DEMO_STOP_BEFORE_UNINSTALL' }
        $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'RentProof\postgres-demo'))
        if (-not [StringComparer]::OrdinalIgnoreCase.Equals($paths.Root, $expected)) { throw 'POSTGRES_DEMO_UNINSTALL_TARGET_INVALID' }
        Assert-RentProofNoReparseTree -Root $paths.Root
        Remove-Item -LiteralPath $paths.Root -Recurse -Force
        Write-SafeStatus 'POSTGRES_DEMO_UNINSTALLED'
    }
}
