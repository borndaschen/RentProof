import { describe, expect, it } from "vitest";
import { parseSecureLanProfile } from "./secure-lan-profile";

const base = {
  RENTPROOF_DEPLOYMENT_PROFILE: "lan_secure_demo",
  RENTPROOF_BIND_HOST: "172.16.102.98",
  RENTPROOF_PORT: "3443",
  RENTPROOF_INTERNAL_PORT: "3100",
  RENTPROOF_PUBLIC_ORIGIN: "https://172.16.102.98:3443",
  RENTPROOF_ALLOWED_HOSTS: "172.16.102.98:3443",
  RENTPROOF_ALLOWED_ORIGINS: "https://172.16.102.98:3443",
  RENTPROOF_ALLOW_REAL_DATA: "true",
  RENTPROOF_AUTH_MODE: "self_hosted",
  RENTPROOF_AUTH_TOKEN_KEY: "a".repeat(43),
  RENTPROOF_DATABASE_ADAPTER: "postgres",
  RENTPROOF_DATABASE_URL: "postgresql://rentproof_app:secret@127.0.0.1:55432/rentproof_secure_demo",
  RENTPROOF_DATABASE_ROLE: "app",
  RENTPROOF_DATABASE_ENVIRONMENT: "secure_demo",
  RENTPROOF_DATABASE_MAX_CONNECTIONS: "4",
  RENTPROOF_REAL_DATA_DIR: "C:\\private\\rentproof-real-data",
  RENTPROOF_DATA_ENCRYPTION_KEY: "b".repeat(43),
  RENTPROOF_INTERNAL_PROXY_TOKEN: "c".repeat(43),
  RENTPROOF_LLM_MODE: "fixture",
  OPENAI_PROJECT_LIMITS_CONFIRMED: "false",
  RENTPROOF_TLS_CERT_PATH: "C:\\certs\\server.cert.pem",
  RENTPROOF_TLS_KEY_PATH: "C:\\certs\\server.key.pem",
  RENTPROOF_TLS_CA_PATH: "C:\\certs\\ca.cert.pem",
  RENTPROOF_LAN_NO_PORT_FORWARDING: "confirmed-for-this-run",
  RENTPROOF_LAN_NO_UPNP_EXPOSURE: "confirmed-for-this-run",
  RENTPROOF_LAN_NO_TUNNEL: "confirmed-for-this-run",
} as const;

describe("parseSecureLanProfile", () => {
  it("accepts one exact HTTPS origin and a separate loopback port", () => {
    expect(parseSecureLanProfile(base)).toMatchObject({
      bindAddress: "172.16.102.98",
      externalPort: 3443,
      internalPort: 3100,
      exactHost: "172.16.102.98:3443",
      exactOrigin: "https://172.16.102.98:3443",
    });
  });

  it.each([
    { RENTPROOF_DEPLOYMENT_PROFILE: "lan_development" },
    { RENTPROOF_PUBLIC_ORIGIN: "http://172.16.102.98:3443" },
    { RENTPROOF_ALLOWED_HOSTS: "*" },
    { RENTPROOF_ALLOWED_ORIGINS: "https://evil.test" },
    { RENTPROOF_ALLOW_REAL_DATA: "false" },
    { RENTPROOF_AUTH_MODE: "synthetic" },
    { RENTPROOF_INTERNAL_PORT: "3443" },
    { RENTPROOF_TLS_KEY_PATH: "..\\server.key.pem" },
    { RENTPROOF_LAN_NO_TUNNEL: "missing" },
  ])("rejects an unsafe profile override %o", (override) => {
    expect(() => parseSecureLanProfile({ ...base, ...override })).toThrow(
      "SECURE_LAN_CONFIGURATION_INVALID",
    );
  });

  it("requires confirmed Project limits before Live mode", () => {
    expect(() => parseSecureLanProfile({ ...base, RENTPROOF_LLM_MODE: "live" })).toThrow(
      "SECURE_LAN_CONFIGURATION_INVALID",
    );
    expect(
      parseSecureLanProfile({
        ...base,
        RENTPROOF_LLM_MODE: "live",
        OPENAI_PROJECT_LIMITS_CONFIRMED: "true",
      }),
    ).toBeDefined();
  });
});
