import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const bootstrap = readFileSync(
  resolve(process.cwd(), "scripts", "postgres-demo-bootstrap.sql"),
  "utf8",
);
const finalize = readFileSync(
  resolve(process.cwd(), "scripts", "postgres-demo-finalize.sql"),
  "utf8",
);
const bootstrapSql = bootstrap
  .split(/\r?\n/u)
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("PostgreSQL Synthetic Demo operator SQL", () => {
  it("contains no embedded role password", () => {
    expect(bootstrapSql).not.toMatch(/PASSWORD\s+'[^']+'/iu);
    expect(bootstrapSql).not.toMatch(/\\set\s+\S*password/iu);
    expect(bootstrapSql).toContain("LOGIN PASSWORD NULL");
  });

  it("creates separate owner, migration and app roles without elevated flags", () => {
    expect(bootstrapSql).toContain("rentproof_demo_owner NOLOGIN");
    expect(bootstrapSql).toContain("rentproof_demo_migration LOGIN PASSWORD NULL");
    expect(bootstrapSql).toContain("rentproof_demo_app LOGIN PASSWORD NULL");
    expect(
      bootstrapSql.match(/NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/gu),
    ).toHaveLength(3);
  });

  it("revokes public access and gives the app no schema create privilege", () => {
    expect(bootstrapSql).toContain("REVOKE ALL ON DATABASE rentproof_demo FROM PUBLIC");
    expect(bootstrapSql).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    expect(bootstrapSql).toContain("GRANT USAGE ON SCHEMA rentproof TO rentproof_demo_app");
    expect(bootstrapSql).not.toContain(
      "GRANT USAGE, CREATE ON SCHEMA rentproof TO rentproof_demo_app",
    );
  });

  it("removes app access to migration metadata during finalization", () => {
    expect(finalize).toContain(
      "REVOKE ALL ON TABLE rentproof.kysely_migration FROM rentproof_demo_app",
    );
    expect(finalize).toContain(
      "REVOKE ALL ON TABLE rentproof.kysely_migration_lock FROM rentproof_demo_app",
    );
    for (const table of [
      "auth_credentials",
      "auth_sessions",
      "auth_password_reset_challenges",
      "auth_email_verification_challenges",
    ]) {
      expect(finalize).toContain(`rentproof.${table}`);
    }
  });
});
