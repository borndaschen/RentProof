import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const common = readFileSync(
  resolve(process.cwd(), "scripts", "windows", "RentProofPostgresDemo.Common.ps1"),
  "utf8",
);
const manager = readFileSync(
  resolve(process.cwd(), "scripts", "windows", "Manage-RentProofPostgresDemo.ps1"),
  "utf8",
);
const scripts = `${common}\n${manager}`;

describe("user-owned PostgreSQL 18 Demo cluster scripts", () => {
  it("keeps both PowerShell manager files syntactically valid", () => {
    for (const path of [
      resolve(process.cwd(), "scripts", "windows", "RentProofPostgresDemo.Common.ps1"),
      resolve(process.cwd(), "scripts", "windows", "Manage-RentProofPostgresDemo.ps1"),
    ]) {
      const command = [
        "$tokens = $null",
        "$errors = $null",
        `[Management.Automation.Language.Parser]::ParseFile('${path.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors) | Out-Null`,
        "if ($errors.Count -ne 0) { exit 1 }",
      ].join("; ");
      expect(
        spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
          encoding: "utf8",
          windowsHide: true,
        }).status,
      ).toBe(0);
    }
  });

  it("uses only the exact LocalAppData root, PostgreSQL 18 and explicit non-service port", () => {
    expect(common).toContain("RentProof\\postgres-demo");
    expect(common).toContain("C:\\Program Files\\PostgreSQL\\18\\bin");
    expect(common).toContain("$script:RentProofPgPort = 55432");
    expect(scripts).not.toMatch(/New-Service|Set-Service|Stop-Service|sc\.exe/iu);
    expect(manager).toContain("C:\\Program Files\\nodejs\\node.exe");
    expect(manager).toContain("FileMajorPart -ne 24");
    expect(manager).not.toContain("pnpm.CMD");
  });

  it("keeps read-only migration readiness separate from schema mutation", () => {
    expect(manager).toContain("'MigrationReadiness'");
    const readinessBlock = manager.slice(
      manager.indexOf("'MigrationReadiness' {"),
      manager.indexOf("'Migrate' {", manager.indexOf("'MigrationReadiness' {")),
    );
    expect(readinessBlock).toContain("postgres-readiness.mts");
    expect(readinessBlock).not.toContain("postgres-migrate.mts");
    expect(readinessBlock).not.toContain("postgres-demo-finalize.sql");
  });

  it("runs Smoke only with app readiness and the synthetic smoke script", () => {
    const smokeBlock = manager.slice(
      manager.indexOf("'Smoke' {"),
      manager.indexOf("'Uninstall' {", manager.indexOf("'Smoke' {")),
    );
    expect(smokeBlock).toContain("Use-DatabaseEnvironment -Role 'rentproof_demo_app'");
    expect(smokeBlock).toContain("postgres-readiness.mts");
    expect(smokeBlock).toContain("postgres-synthetic-smoke.mts");
    expect(smokeBlock).not.toContain("postgres-migrate.mts");
    expect(smokeBlock).not.toContain("rentproof_demo_admin");
  });

  it("requires fixed NTFS, rejects reparse points and validates the ownership marker", () => {
    expect(common).toContain("[IO.DriveType]::Fixed");
    expect(common).toContain("$volume.DriveFormat -ne 'NTFS'");
    expect(common).toContain("POSTGRES_DEMO_REPARSE_FORBIDDEN");
    expect(common).toContain("rentproof.postgres-demo-owner.v1");
    expect(common).toContain("marker.ownerSid");
    expect(common).toContain("WindowsIdentity]::GetCurrent().User.Value");
    expect(manager).toContain("Assert-RentProofPostgresDemoMarker -Paths $paths");
  });

  it("checks inheritance and grant ACL commands independently", () => {
    const inheritanceCheck = common.indexOf("POSTGRES_DEMO_ACL_INHERITANCE_FAILED");
    const grantCommand = common.indexOf("'/grant:r'");
    const grantCheck = common.indexOf("POSTGRES_DEMO_ACL_GRANT_FAILED");
    expect(inheritanceCheck).toBeGreaterThan(0);
    expect(grantCommand).toBeGreaterThan(inheritanceCheck);
    expect(grantCheck).toBeGreaterThan(grantCommand);
    expect(common).toContain("POSTGRES_DEMO_ACL_PRINCIPAL_FORBIDDEN");
  });

  it("handles zero, scalar and multiple listener matches under StrictMode", () => {
    const commonPath = resolve(
      process.cwd(),
      "scripts",
      "windows",
      "RentProofPostgresDemo.Common.ps1",
    ).replaceAll("'", "''");
    const command = [
      "Set-StrictMode -Version Latest",
      `. '${commonPath}'`,
      "$one = '  TCP  127.0.0.1:55432  0.0.0.0:0  LISTENING  100'",
      "$two = '  TCP  [::1]:55432  [::]:0  LISTENING  100'",
      "$realShaped = @('', 'Active Connections', '', '  Proto  Local Address  Foreign Address  State  PID', $one, '')",
      "$zero = Get-RentProofPortListenerCount -NetstatLines @() -Port 55432",
      "$single = Get-RentProofPortListenerCount -NetstatLines @($one) -Port 55432",
      "$multiple = Get-RentProofPortListenerCount -NetstatLines @($one,$two) -Port 55432",
      "$real = Get-RentProofPortListenerCount -NetstatLines $realShaped -Port 55432",
      "@($zero,$single,$multiple,$real) -join ','",
    ].join("; ");
    const result = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0,1,2,1");
  });

  it("uses random credentials and SCRAM without trust or blank-password startup", () => {
    expect(common).toContain("RandomNumberGenerator]::GetBytes(32)");
    expect(manager).toContain("--auth-host=scram-sha-256");
    expect(manager).toContain("--auth-local=scram-sha-256");
    expect(manager).toContain("password_encryption = 'scram-sha-256'");
    expect(manager).not.toMatch(/\btrust\b/iu);
    expect(manager).not.toContain("--no-password");
  });

  it("adds a distinct exact 32-byte base64url auth key without broadening the secret file", () => {
    expect(common).toContain("New-RentProofBase64UrlSecret");
    expect(common).toContain("TrimEnd('=').Replace('+', '-').Replace('/', '_')");
    expect(common).toContain("@('admin', 'migration', 'app', 'authToken')");
    expect(common).toContain("'^[A-Za-z0-9_-]{43}$'");
    expect(manager).toContain("authToken = New-RentProofBase64UrlSecret");
    expect(manager).not.toMatch(/Write-(?:Output|Host).*authToken/iu);
  });

  it("constructs an exact private self-hosted fixture environment", () => {
    expect(common).toContain("Set-RentProofPostgresDemoAppEnvironment");
    expect(common).toContain("Get-RentProofPostgresDemoAppEnvironment");
    expect(common).toContain("RENTPROOF_AUTH_MODE=self_hosted");
    expect(common).toContain("RENTPROOF_AUTH_TOKEN_KEY=");
    expect(common).toContain("RENTPROOF_LLM_MODE=fixture");
    expect(common).toContain("RENTPROOF_ALLOW_REAL_DATA=false");
    expect(common).toContain("RENTPROOF_BIND_HOST=127.0.0.1");
    expect(common).toContain("RENTPROOF_PORT=3000");
    expect(common).toContain("POSTGRES_DEMO_APP_ENV_INVALID");
    expect(common).toContain("POSTGRES_DEMO_APP_ENV_SECRET_MISMATCH");
    expect(manager).toContain("Assert-RentProofPostgresDemoAppEnvironmentMatchesSecrets");
  });

  it("round-trips the private app environment and rejects an injected key", () => {
    const commonPath = resolve(
      process.cwd(),
      "scripts",
      "windows",
      "RentProofPostgresDemo.Common.ps1",
    ).replaceAll("'", "''");
    const command = [
      "Set-StrictMode -Version Latest",
      `. '${commonPath}'`,
      "$rpTestRoot = Join-Path ([IO.Path]::GetTempPath()) ('rentproof-auth-env-' + [Guid]::NewGuid().ToString('N'))",
      "New-Item -ItemType Directory -Path $rpTestRoot | Out-Null",
      "$rpPaths = [pscustomobject]@{ AppEnv = (Join-Path $rpTestRoot '.env.private') }",
      "$rpSecrets = [pscustomobject]@{ app = (New-RentProofRandomSecret); authToken = (New-RentProofBase64UrlSecret) }",
      "$rpResult = 'none'",
      "try { Set-RentProofPostgresDemoAppEnvironment -Paths $rpPaths -Secrets $rpSecrets; $rpValues = Get-RentProofPostgresDemoAppEnvironment -Paths $rpPaths; if ($rpValues.RENTPROOF_AUTH_MODE -ne 'self_hosted' -or $rpValues.Count -ne 22) { throw 'roundtrip' }; Add-Content -LiteralPath $rpPaths.AppEnv -Value 'INJECTED_KEY=no'; try { Get-RentProofPostgresDemoAppEnvironment -Paths $rpPaths | Out-Null } catch { $rpResult = $_.Exception.Message } } finally { Remove-Item -LiteralPath $rpTestRoot -Recurse -Force }",
      "$rpResult",
    ].join("; ");
    const result = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("POSTGRES_DEMO_APP_ENV_INVALID");
    expect(result.stdout).not.toContain("RENTPROOF_AUTH_TOKEN_KEY");
    expect(result.stdout).not.toContain("postgresql://");
  });

  it("starts auth only after build, DB and standard-user gates without command-line secrets", () => {
    expect(manager).toContain("'StartAuthDemo'");
    expect(manager).toContain("'StopAuthDemo'");
    expect(manager).toContain("'StatusAuthDemo'");
    const startBlock = manager.slice(
      manager.indexOf("function Start-AuthDemo"),
      manager.indexOf("function Stop-AuthDemo"),
    );
    expect(startBlock).toContain("Assert-AuthDemoStandardUser");
    expect(startBlock).toContain(".next\\BUILD_ID");
    expect(startBlock).toContain("postgres-readiness.mts");
    expect(startBlock).toContain("Get-RentProofPostgresDemoAppEnvironment");
    expect(startBlock).toContain("Start-Process");
    expect(startBlock).toContain("-Environment $startEnvironment");
    expect(startBlock).toContain("scripts\\run-next.mjs");
    expect(startBlock).not.toContain("RENTPROOF_AUTH_TOKEN_KEY=$");
    expect(startBlock).not.toContain("RENTPROOF_DATABASE_URL=$");
  });

  it("runs Auth HTTP smoke only against the validated healthy managed process", () => {
    const block = manager.slice(
      manager.indexOf("'AuthHttpSmoke' {"),
      manager.indexOf("'Uninstall' {", manager.indexOf("'AuthHttpSmoke' {")),
    );
    expect(block).toContain("Assert-AuthDemoStandardUser");
    expect(block).toContain("Assert-RentProofPostmasterContainment");
    expect(block).toContain("Get-AuthDemoProcess");
    expect(block).toContain("Test-AuthDemoHealth");
    expect(block).toContain("Get-RentProofPostgresDemoAppEnvironment");
    expect(block).toContain("postgres-readiness.mts");
    expect(block).toContain("auth-http-synthetic-smoke.mts");
    expect(block).not.toContain("Start-AuthDemo");
    expect(block).not.toContain("Stop-AuthDemo");
  });

  it("exposes a read-only Auth HTTP residue diagnostic action", () => {
    const block = manager.slice(
      manager.indexOf("'AuthHttpResidueCheck' {"),
      manager.indexOf("'Uninstall' {", manager.indexOf("'AuthHttpResidueCheck' {")),
    );
    expect(block).toContain("auth-http-synthetic-residue-check.mts");
    expect(block).toContain("Get-RentProofPostgresDemoAppEnvironment");
    expect(block).not.toContain("auth-http-synthetic-smoke.mts");
    expect(block).not.toContain("Start-AuthDemo");
    expect(block).not.toContain("Stop-AuthDemo");
  });

  it("parses auth process timestamps as strict UTC and permits at most one second precision drift", () => {
    const commonPath = resolve(
      process.cwd(),
      "scripts",
      "windows",
      "RentProofPostgresDemo.Common.ps1",
    ).replaceAll("'", "''");
    const command = [
      "Set-StrictMode -Version Latest",
      `. '${commonPath}'`,
      "$rpNow = [datetime]'2026-09-03T03:00:00.0000000Z'",
      "$rpAccepted = 'no'",
      "Assert-RentProofAuthProcessStartTime -MarkerStartedAt '2026-09-03T02:34:26.0000000Z' -ProcessStartedAt ([datetime]'2026-09-03T02:34:26.9000000Z') -UtcNow $rpNow",
      "$rpAccepted = 'yes'",
      "$rpMismatch = 'none'",
      "try { Assert-RentProofAuthProcessStartTime -MarkerStartedAt '2026-09-03T02:34:26.0000000Z' -ProcessStartedAt ([datetime]'2026-09-03T02:34:27.0010000Z') -UtcNow $rpNow } catch { $rpMismatch = $_.Exception.Message }",
      "$rpInvalid = 'none'",
      "try { Assert-RentProofAuthProcessStartTime -MarkerStartedAt '9/3/2026 2:34:26 AM' -ProcessStartedAt ([datetime]'2026-09-03T02:34:26.0000000Z') -UtcNow $rpNow } catch { $rpInvalid = $_.Exception.Message }",
      "$rpFuture = 'none'",
      "try { Assert-RentProofAuthProcessStartTime -MarkerStartedAt '2026-09-03T03:00:00.1000000Z' -ProcessStartedAt ([datetime]'2026-09-03T03:00:00.1000000Z') -UtcNow $rpNow } catch { $rpFuture = $_.Exception.Message }",
      '"$rpAccepted,$rpMismatch,$rpInvalid,$rpFuture"',
    ].join("; ");
    const result = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      "yes,AUTH_DEMO_PROCESS_MISMATCH,AUTH_DEMO_PROCESS_MARKER_INVALID,AUTH_DEMO_PROCESS_MARKER_INVALID",
    );
  });

  it("requires the 12 product tables including all four migration 002 tables", () => {
    const readiness = readFileSync(
      resolve(process.cwd(), "scripts", "postgres-readiness.mts"),
      "utf8",
    );
    for (const table of [
      "auth_credentials",
      "auth_sessions",
      "auth_password_reset_challenges",
      "auth_email_verification_challenges",
    ]) {
      expect(readiness).toContain(`'${table}'`);
    }
    expect(readiness).toContain('AS "productTableCount"');
    expect(
      readFileSync(resolve(process.cwd(), "src/adapters/database/postgres/readiness.ts"), "utf8"),
    ).toContain("EXPECTED_PRODUCT_TABLE_COUNT = 12");
  });

  it("never prints psql output and keeps credentials out of command arguments", () => {
    expect(common).toContain("$env:PGPASSWORD = $Password");
    expect(common).toContain("'-f' $SqlFile *> $null");
    expect(manager).not.toMatch(/Write-(?:Output|Host).*Secret/iu);
    expect(manager).not.toMatch(/'-v'.*(?:password|secret)/iu);
  });

  it("validates PID executable and data root before stop and guards uninstall", () => {
    expect(common).toContain("POSTGRES_DEMO_PID_PROCESS_MISMATCH");
    expect(common).toContain("POSTGRES_DEMO_PID_DATA_ROOT_MISMATCH");
    expect(common).toContain("POSTGRES_DEMO_PID_PORT_MISMATCH");
    expect(common).toContain("POSTGRES_DEMO_PID_LISTEN_ADDRESS_MISMATCH");
    expect(common).toContain("POSTGRES_DEMO_PID_STATUS_NOT_READY");
    expect(common).not.toContain("Get-CimInstance Win32_Process");
    expect(manager).toContain("POSTGRES_DEMO_STOP_BEFORE_UNINSTALL");
    expect(manager).toContain("POSTGRES_DEMO_UNINSTALL_TARGET_INVALID");
    expect(manager).toContain("Assert-RentProofNoReparseTree -Root $paths.Root");
  });

  it("validates authoritative postmaster.pid metadata without WMI", () => {
    const commonPath = resolve(
      process.cwd(),
      "scripts",
      "windows",
      "RentProofPostgresDemo.Common.ps1",
    ).replaceAll("'", "''");
    const dataPath = resolve(process.cwd(), "tmp", "postgres-pid-test").replaceAll("'", "''");
    const command = [
      "Set-StrictMode -Version Latest",
      `. '${commonPath}'`,
      `$paths = [pscustomobject]@{ Data = '${dataPath}' }`,
      `$valid = @('1234','${dataPath}','0','55432','','127.0.0.1','0 0','ready')`,
      "$pidValue = Assert-RentProofPostmasterPidMetadata -Paths $paths -Lines $valid",
      "$invalid = @($valid)",
      "$invalid[3] = '5432'",
      "$code = 'none'",
      "try { Assert-RentProofPostmasterPidMetadata -Paths $paths -Lines $invalid | Out-Null } catch { $code = $_.Exception.Message }",
      '"$pidValue,$code"',
    ].join("; ");
    const result = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("1234,POSTGRES_DEMO_PID_PORT_MISMATCH");
  });

  it("accepts optional IPv6 loopback but rejects any advertised LAN address", () => {
    const commonPath = resolve(
      process.cwd(),
      "scripts",
      "windows",
      "RentProofPostgresDemo.Common.ps1",
    ).replaceAll("'", "''");
    const dataPath = resolve(process.cwd(), "tmp", "postgres-pid-test").replaceAll("'", "''");
    const command = [
      "Set-StrictMode -Version Latest",
      `. '${commonPath}'`,
      `$paths = [pscustomobject]@{ Data = '${dataPath}' }`,
      `$valid = @('1234','${dataPath}','0','55432','','127.0.0.1,::1','0 0','ready')`,
      "$accepted = Assert-RentProofPostmasterPidMetadata -Paths $paths -Lines $valid",
      "$valid[5] = '127.0.0.1,192.168.1.20'",
      "$code = 'none'",
      "try { Assert-RentProofPostmasterPidMetadata -Paths $paths -Lines $valid | Out-Null } catch { $code = $_.Exception.Message }",
      '"$accepted,$code"',
    ].join("; ");
    const result = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("1234,POSTGRES_DEMO_PID_LISTEN_ADDRESS_MISMATCH");
  });

  it("invokes full containment under StrictMode without colliding with built-in PID", () => {
    const commonPath = resolve(
      process.cwd(),
      "scripts",
      "windows",
      "RentProofPostgresDemo.Common.ps1",
    ).replaceAll("'", "''");
    const command = [
      "Set-StrictMode -Version Latest",
      `. '${commonPath}'`,
      "$rpTestRoot = Join-Path ([IO.Path]::GetTempPath()) ('rentproof-pid-test-' + [Guid]::NewGuid().ToString('N'))",
      "New-Item -ItemType Directory -Path $rpTestRoot | Out-Null",
      "$rpPidFile = Join-Path $rpTestRoot 'postmaster.pid'",
      "$rpLines = @([string]$PID,$rpTestRoot,'0','55432','','127.0.0.1','0 0','ready')",
      "Set-Content -LiteralPath $rpPidFile -Value $rpLines -Encoding UTF8",
      "$rpPaths = [pscustomobject]@{ Data = $rpTestRoot }",
      "$rpCode = 'none'",
      "try { Assert-RentProofPostmasterContainment -Paths $rpPaths | Out-Null } catch { $rpCode = $_.Exception.Message } finally { Remove-Item -LiteralPath $rpPidFile -Force; Remove-Item -LiteralPath $rpTestRoot -Force }",
      "$rpCode",
    ].join("; ");
    const result = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("POSTGRES_DEMO_PID_PROCESS_MISMATCH");
  });

  it("runs a detached child with redirected handles and waits for the launcher exit", () => {
    const commonPath = resolve(
      process.cwd(),
      "scripts",
      "windows",
      "RentProofPostgresDemo.Common.ps1",
    ).replaceAll("'", "''");
    const command = [
      "Set-StrictMode -Version Latest",
      `. '${commonPath}'`,
      "$rpTestRoot = Join-Path ([IO.Path]::GetTempPath()) ('rentproof-detached-test-' + [Guid]::NewGuid().ToString('N'))",
      "New-Item -ItemType Directory -Path $rpTestRoot | Out-Null",
      "$rpOut = Join-Path $rpTestRoot 'stdout.log'",
      "$rpErr = Join-Path $rpTestRoot 'stderr.log'",
      "$rpLauncher = Join-Path $rpTestRoot 'launcher.mjs'",
      "$rpSource = \"import { spawn } from 'node:child_process'; const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); child.unref();\"",
      "Set-Content -LiteralPath $rpLauncher -Value $rpSource -Encoding UTF8",
      "$rpTimer = [Diagnostics.Stopwatch]::StartNew()",
      "$rpExit = Invoke-RentProofDetachedCommand -FilePath 'C:\\Program Files\\nodejs\\node.exe' -ArgumentList @($rpLauncher) -StandardOutputPath $rpOut -StandardErrorPath $rpErr",
      "$rpTimer.Stop()",
      "$rpElapsed = $rpTimer.ElapsedMilliseconds",
      "Start-Sleep -Milliseconds 3300",
      "Remove-Item -LiteralPath $rpLauncher,$rpOut,$rpErr -Force",
      "Remove-Item -LiteralPath $rpTestRoot -Force",
      '"$rpExit,$rpElapsed"',
    ].join("; ");
    const result = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    const [exitCode, elapsed] = result.stdout.trim().split(",");
    expect(exitCode).toBe("0");
    expect(Number(elapsed)).toBeLessThan(2_000);
  }, 15_000);
});
