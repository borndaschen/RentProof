import { describe, expect, it } from "vitest";
import { parsePostgresDatabaseConfig, PostgresConfigurationError } from "./config";

const syntheticEnvironment = {
  RENTPROOF_DATABASE_ADAPTER: "postgres",
  RENTPROOF_DATABASE_URL: "postgresql://rentproof_app:secret@127.0.0.1:5432/rentproof_demo",
  RENTPROOF_DATABASE_ROLE: "app",
  RENTPROOF_DATABASE_ENVIRONMENT: "synthetic_demo",
  RENTPROOF_DATABASE_MAX_CONNECTIONS: "4",
  RENTPROOF_DEPLOYMENT_PROFILE: "lan_development",
  RENTPROOF_ALLOW_REAL_DATA: "false",
  RENTPROOF_PUBLIC_ORIGIN: "http://192.168.1.20:3000",
} as const;

describe("parsePostgresDatabaseConfig", () => {
  it("allows an explicitly synthetic LAN demo to use only a loopback database", () => {
    expect(parsePostgresDatabaseConfig(syntheticEnvironment)).toEqual({
      connectionString: syntheticEnvironment.RENTPROOF_DATABASE_URL,
      role: "app",
      environment: "synthetic_demo",
      maxConnections: 4,
    });
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts local database host %s", (host) => {
    expect(
      parsePostgresDatabaseConfig({
        ...syntheticEnvironment,
        RENTPROOF_DATABASE_URL: `postgresql://app:secret@${host}:5432/rentproof_demo`,
      }).environment,
    ).toBe("synthetic_demo");
  });

  it("rejects a LAN or public database endpoint", () => {
    expect(() =>
      parsePostgresDatabaseConfig({
        ...syntheticEnvironment,
        RENTPROOF_DATABASE_URL: "postgresql://app:secret@192.168.1.20/rentproof_demo",
      }),
    ).toThrowError(expect.objectContaining({ code: "POSTGRES_REMOTE_ENDPOINT_FORBIDDEN" }));
  });

  it.each([
    { RENTPROOF_ALLOW_REAL_DATA: "true" },
    { RENTPROOF_DATABASE_URL: "postgresql://app:secret@127.0.0.1/rentproof" },
    { RENTPROOF_DATABASE_URL: "postgresql://app:secret@127.0.0.1/notdemo" },
  ])("keeps non-production database use synthetic-only", (override) => {
    expect(() =>
      parsePostgresDatabaseConfig({ ...syntheticEnvironment, ...override }),
    ).toThrowError(expect.objectContaining({ code: "POSTGRES_SYNTHETIC_GATE_REQUIRED" }));
  });

  it.each([
    "postgresql://127.0.0.1/rentproof_demo",
    "postgresql://app@127.0.0.1/rentproof_demo",
    "postgresql://app:secret@127.0.0.1/rentproof_demo%2Fprod",
    "postgresql://app:secret@127.0.0.1/rentproof_demo?sslmode=disable",
    "postgresql://app:secret@127.0.0.1/rentproof_demo#fragment",
  ])("rejects ambiguous or credential-free database URL %s", (connectionString) => {
    expect(() =>
      parsePostgresDatabaseConfig({
        ...syntheticEnvironment,
        RENTPROOF_DATABASE_URL: connectionString,
      }),
    ).toThrowError(expect.objectContaining({ code: "POSTGRES_CONFIGURATION_INVALID" }));
  });

  it("requires HTTPS before a production database configuration is accepted", () => {
    expect(() =>
      parsePostgresDatabaseConfig({
        ...syntheticEnvironment,
        RENTPROOF_DATABASE_URL: "postgresql://app:secret@127.0.0.1/rentproof",
        RENTPROOF_DATABASE_ENVIRONMENT: "production",
        RENTPROOF_DEPLOYMENT_PROFILE: "production",
        RENTPROOF_ALLOW_REAL_DATA: "true",
        RENTPROOF_PUBLIC_ORIGIN: "http://rentproof.example",
      }),
    ).toThrowError(expect.objectContaining({ code: "POSTGRES_TLS_REQUIRED" }));
  });

  it("accepts the local-only production topology only behind HTTPS", () => {
    expect(
      parsePostgresDatabaseConfig({
        ...syntheticEnvironment,
        RENTPROOF_DATABASE_URL: "postgresql://app:secret@localhost/rentproof",
        RENTPROOF_DATABASE_ENVIRONMENT: "production",
        RENTPROOF_DEPLOYMENT_PROFILE: "production",
        RENTPROOF_ALLOW_REAL_DATA: "true",
        RENTPROOF_PUBLIC_ORIGIN: "https://rentproof.example",
      }).environment,
    ).toBe("production");
  });

  it("returns typed errors without echoing credentials", () => {
    const error = new PostgresConfigurationError("POSTGRES_CONFIGURATION_INVALID");
    expect(error.message).toBe("POSTGRES_CONFIGURATION_INVALID");
    expect(error.message).not.toContain("secret");
    expect(() => parsePostgresDatabaseConfig({})).toThrowError(
      expect.objectContaining({ code: "POSTGRES_CONFIGURATION_INVALID" }),
    );
  });
});
