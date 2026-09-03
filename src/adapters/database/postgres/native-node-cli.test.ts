import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function safeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "test",
  };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("RENTPROOF_DATABASE_")) delete environment[name];
  }
  return environment;
}

describe("native Node PostgreSQL operator CLIs", () => {
  it("normalizes PostgreSQL inet without broadening the loopback allowlist", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts", "postgres-readiness.mts"),
      "utf8",
    );
    expect(source).toContain('host(inet_server_addr()) AS "serverAddress"');
    expect(source).not.toContain('inet_server_addr()::text AS "serverAddress"');
  });
  it("loads the readiness graph and reaches the typed configuration gate", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", "postgres-readiness.mts"), "app"],
      { encoding: "utf8", env: safeEnvironment(), windowsHide: true },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("POSTGRES_CONFIGURATION_INVALID");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  }, 15_000);

  it("loads the migration graph and reaches its usage gate", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", "postgres-migrate.mts")],
      { encoding: "utf8", env: safeEnvironment(), windowsHide: true },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: pnpm db:migrate -- up|down");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("loads the synthetic smoke graph and reaches its typed configuration gate", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", "postgres-synthetic-smoke.mts")],
      { encoding: "utf8", env: safeEnvironment(), windowsHide: true },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("POSTGRES_CONFIGURATION_INVALID");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("loads the Auth HTTP smoke graph and reaches its typed configuration gate", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", "auth-http-synthetic-smoke.mts")],
      { encoding: "utf8", env: safeEnvironment(), windowsHide: true },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("POSTGRES_CONFIGURATION_INVALID");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("loads the Auth residue graph and reaches its typed configuration gate", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", "auth-http-synthetic-residue-check.mts")],
      { encoding: "utf8", env: safeEnvironment(), windowsHide: true },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("POSTGRES_CONFIGURATION_INVALID");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("keeps Auth HTTP smoke synthetic, secret-silent, full-flow and residue checked", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts", "auth-http-synthetic-smoke.mts"),
      "utf8",
    );
    expect(source).toContain('process.env.RENTPROOF_ALLOW_REAL_DATA !== "false"');
    expect(source).toContain('process.env.RENTPROOF_LLM_MODE !== "fixture"');
    for (const route of [
      "/api/auth/register",
      "/api/auth/dev-mailbox",
      "/api/auth/registration/verify",
      "/api/auth/login",
      "/api/auth/session",
      "/api/history",
      "/api/auth/logout",
      "/api/auth/password-reset/request",
      "/api/auth/password-reset/complete",
    ]) {
      expect(source).toContain(route);
    }
    expect(source).toContain("afterPassive?.version === beforePassive.version");
    expect(source).toContain("afterHistory.version === beforePassive.version + 1");
    expect(source).toContain('expectStatus(replayLogin, 401, "REPLAY")');
    expect(source).toContain('.deleteFrom("internal_users")');
    expect(source).toContain("AUTH_HTTP_SMOKE_CLEANUP_FAILED");
    for (const phase of [
      "SESSION_BOOTSTRAP",
      "RUNTIME_PROBE",
      "REGISTER",
      "MAILBOX_VERIFY",
      "VERIFY",
      "LOGIN",
      "PASSIVE",
      "HISTORY_SLIDE",
      "LOGOUT",
      "RESET_REQUEST",
      "RESET_MAILBOX",
      "RESET_COMPLETE",
      "REPLAY",
    ]) {
      expect(source).toContain(`AUTH_HTTP_SMOKE_${phase}_FAILED`);
    }
    expect(source).not.toMatch(/console\.(?:log|error)/gu);
    expect(source).toContain('process.stdout.write("AUTH_HTTP_SYNTHETIC_SMOKE_OK\\n")');
  });

  it("keeps the residue check read-only and silent about matching identities", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts", "auth-http-synthetic-residue-check.mts"),
      "utf8",
    );
    expect(source).toContain("synthetic-auth-%@example.test");
    expect(source).toContain("AUTH_HTTP_SYNTHETIC_RESIDUE_ZERO");
    expect(source).toContain("AUTH_HTTP_SYNTHETIC_RESIDUE_DETECTED");
    expect(source).not.toMatch(/deleteFrom|updateTable|insertInto/gu);
    expect(source).not.toMatch(/console\.(?:log|error)/gu);
  });

  it("keeps smoke synthetic, app-only, owner-scoped, CAS-aware and self-cleaning", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts", "postgres-synthetic-smoke.mts"),
      "utf8",
    );
    expect(source).toContain('config.role !== "app"');
    expect(source).toContain('config.environment !== "synthetic_demo"');
    expect(source).toContain('.where("owner_subject_id", "=", ownerAId)');
    expect(source).toContain('.where("owner_subject_id", "=", ownerBId)');
    expect(source).toContain('.where("revision", "=", 0)');
    expect(source).toContain('.insertInto("auth_credentials")');
    expect(source).toContain('.insertInto("auth_sessions")');
    expect(source).toContain('.insertInto("auth_password_reset_challenges")');
    expect(source).toContain('.insertInto("auth_email_verification_challenges")');
    expect(source).toContain('.where("user_id", "=", ownerBId)');
    expect(source).toContain("remainingResetChallenges.length !== 0");
    expect(source).toContain("remainingVerificationChallenges.length !== 0");
    expect(source).toContain("finally {");
    expect(source).toContain('.deleteFrom("rental_cases")');
    expect(source).toContain('.deleteFrom("internal_users")');
    expect(source).not.toMatch(/console\.(?:log|error)|JSON\.stringify/gu);
  });
});
