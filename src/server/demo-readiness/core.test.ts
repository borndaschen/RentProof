import { describe, expect, it, vi } from "vitest";
import { checkDemoReadiness, type DemoReadinessDependencies, type DemoReadinessItem } from "./core";

const hash = "f3797356a1e3ea4bbed7a87802fdaaa001985557fb7b51845a9f6a4454157d7b";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    RENTPROOF_DEPLOYMENT_PROFILE: "local_development",
    RENTPROOF_BIND_HOST: "127.0.0.1",
    RENTPROOF_PORT: "3000",
    RENTPROOF_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
    RENTPROOF_ALLOWED_HOSTS: "localhost:3000,127.0.0.1:3000",
    RENTPROOF_ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
    RENTPROOF_ALLOW_REAL_DATA: "false",
    RENTPROOF_AUTH_MODE: "synthetic",
    RENTPROOF_RULE_PROFILE: "p0",
    RENTPROOF_LLM_MODE: "fixture",
    OPENAI_PROJECT_LIMITS_CONFIRMED: "false",
    RENTPROOF_DEMO_CASE_VERSION: "golden-v1",
    RENTPROOF_DATABASE_ADAPTER: "disabled",
    RENTPROOF_DATABASE_ROLE: "app",
    RENTPROOF_DATABASE_ENVIRONMENT: "synthetic_demo",
    RENTPROOF_DATABASE_MAX_CONNECTIONS: "4",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<DemoReadinessDependencies> = {},
): DemoReadinessDependencies {
  return {
    verifyToolchain: vi.fn(async () => ({ nodeVersion: "24.20.0", pnpmVersion: "11.25.0" })),
    verifyGolden: vi.fn(async () => ({ manifestHash: hash, fileCount: 18 })),
    verifyRuntimeRoot: vi.fn(async () => "ready" as const),
    isPortAvailable: vi.fn(async () => true),
    getLanFirewallState: vi.fn(async () => "ready" as const),
    isTcpListenerReachable: vi.fn(async () => true),
    ...overrides,
  };
}

function byCode(items: readonly DemoReadinessItem[], code: string): DemoReadinessItem | undefined {
  return items.find((item) => item.code === code);
}

describe("checkDemoReadiness", () => {
  it("returns a typed passing report for the default local synthetic Demo", async () => {
    const deps = dependencies();
    const report = await checkDemoReadiness({
      profile: "local",
      environment: environment(),
      repositoryRoot: "C:\\work\\RentProof",
      userProfile: "C:\\Users\\Demo",
      localAppData: "C:\\Users\\Demo\\AppData\\Local",
      dependencies: deps,
    });

    expect(report.schemaVersion).toBe("rentproof.demo-readiness.v1");
    expect(report.blocked).toBe(false);
    expect(report.items.every((item) => item.level === "PASS")).toBe(true);
    expect(byCode(report.items, "DEMO_SEAL_VERIFIED")?.message).toContain(hash);
    expect(deps.getLanFirewallState).not.toHaveBeenCalled();
  });

  it("blocks account auth on LAN and does not expose its HMAC secret", async () => {
    const secret = "s".repeat(43);
    const report = await checkDemoReadiness({
      profile: "lan",
      environment: environment({
        RENTPROOF_DEPLOYMENT_PROFILE: "lan_development",
        RENTPROOF_BIND_HOST: "192.168.1.20",
        RENTPROOF_PUBLIC_ORIGIN: "http://192.168.1.20:3000",
        RENTPROOF_ALLOWED_HOSTS: "192.168.1.20:3000",
        RENTPROOF_ALLOWED_ORIGINS: "http://192.168.1.20:3000",
        RENTPROOF_LAN_NO_PORT_FORWARDING: "confirmed-for-this-run",
        RENTPROOF_LAN_NO_UPNP_EXPOSURE: "confirmed-for-this-run",
        RENTPROOF_LAN_NO_TUNNEL: "confirmed-for-this-run",
        RENTPROOF_AUTH_MODE: "self_hosted",
        RENTPROOF_AUTH_TOKEN_KEY: secret,
      }),
      repositoryRoot: "C:\\work\\RentProof",
      userProfile: "C:\\Users\\Demo",
      localAppData: "C:\\Users\\Demo\\AppData\\Local",
      dependencies: dependencies({
        getLanFirewallState: vi.fn(async () => "disabled" as const),
      }),
    });

    expect(report.blocked).toBe(true);
    expect(byCode(report.items, "LAN_FIREWALL_DISABLED")?.level).toBe("BLOCKED");
    expect(byCode(report.items, "LAN_AUTH_FORBIDDEN")?.level).toBe("BLOCKED");
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("reports each LAN exposure confirmation and a missing firewall rule separately", async () => {
    const report = await checkDemoReadiness({
      profile: "lan",
      environment: environment({
        RENTPROOF_DEPLOYMENT_PROFILE: "lan_development",
        RENTPROOF_BIND_HOST: "172.16.102.98",
        RENTPROOF_PUBLIC_ORIGIN: "http://172.16.102.98:3000",
        RENTPROOF_ALLOWED_HOSTS: "172.16.102.98:3000",
        RENTPROOF_ALLOWED_ORIGINS: "http://172.16.102.98:3000",
      }),
      repositoryRoot: "C:\\work\\RentProof",
      userProfile: "C:\\Users\\Demo",
      localAppData: "C:\\Users\\Demo\\AppData\\Local",
      dependencies: dependencies({
        getLanFirewallState: vi.fn(async () => "missing" as const),
      }),
    });

    expect(byCode(report.items, "LAN_NO_PORT_FORWARDING_UNCONFIRMED")?.level).toBe("BLOCKED");
    expect(byCode(report.items, "LAN_NO_UPNP_EXPOSURE_UNCONFIRMED")?.level).toBe("BLOCKED");
    expect(byCode(report.items, "LAN_NO_TUNNEL_UNCONFIRMED")?.level).toBe("BLOCKED");
    expect(byCode(report.items, "LAN_FIREWALL_RULE_MISSING")?.level).toBe("BLOCKED");
  });

  it("warns for unconfirmed Live Project limits without making a provider call", async () => {
    const report = await checkDemoReadiness({
      profile: "local",
      environment: environment({
        RENTPROOF_LLM_MODE: "live",
        OPENAI_API_KEY: "secret-not-output",
        OPENAI_PROJECT_LIMITS_CONFIRMED: "false",
      }),
      repositoryRoot: "C:\\work\\RentProof",
      userProfile: "C:\\Users\\Demo",
      localAppData: "C:\\Users\\Demo\\AppData\\Local",
      dependencies: dependencies({
        verifyRuntimeRoot: vi.fn(async () => "safe_uninitialized" as const),
      }),
    });

    expect(report.blocked).toBe(false);
    expect(byCode(report.items, "OPENAI_PROJECT_LIMITS_UNVERIFIED")?.level).toBe("WARN");
    expect(byCode(report.items, "RUNTIME_ROOT_SAFE_UNINITIALIZED")?.level).toBe("WARN");
    expect(JSON.stringify(report)).not.toContain("secret-not-output");
  });

  it("validates PostgreSQL configuration and checks only its loopback TCP listener", async () => {
    const listener = vi.fn(async () => true);
    const report = await checkDemoReadiness({
      profile: "local",
      environment: environment({
        RENTPROOF_DATABASE_ADAPTER: "postgres",
        RENTPROOF_DATABASE_URL:
          "postgresql://rentproof_app:never-output@127.0.0.1:5432/rentproof_demo",
      }),
      repositoryRoot: "C:\\work\\RentProof",
      userProfile: "C:\\Users\\Demo",
      localAppData: "C:\\Users\\Demo\\AppData\\Local",
      dependencies: dependencies({ isTcpListenerReachable: listener }),
    });

    expect(report.blocked).toBe(false);
    expect(listener).toHaveBeenCalledWith("127.0.0.1", 5432);
    expect(byCode(report.items, "POSTGRES_LOOPBACK_LISTENER_READY")?.level).toBe("PASS");
    expect(JSON.stringify(report)).not.toContain("never-output");
  });

  it("recognizes a complete localhost self-hosted auth configuration without displaying its key", async () => {
    const tokenKey = "k".repeat(43);
    const report = await checkDemoReadiness({
      profile: "local",
      environment: environment({
        RENTPROOF_AUTH_MODE: "self_hosted",
        RENTPROOF_AUTH_TOKEN_KEY: tokenKey,
        RENTPROOF_DATABASE_ADAPTER: "postgres",
        RENTPROOF_DATABASE_URL:
          "postgresql://rentproof_app:never-output@127.0.0.1:55432/rentproof_demo",
      }),
      repositoryRoot: "C:\\work\\RentProof",
      userProfile: "C:\\Users\\Demo",
      localAppData: "C:\\Users\\Demo\\AppData\\Local",
      dependencies: dependencies(),
    });
    expect(byCode(report.items, "LOCAL_SELF_HOSTED_AUTH_CONFIGURATION_PRESENT")?.level).toBe(
      "PASS",
    );
    expect(JSON.stringify(report)).not.toContain(tokenKey);
  });

  it("blocks invalid Golden selection, occupied ports, and missing Live configuration", async () => {
    const report = await checkDemoReadiness({
      profile: "local",
      environment: environment({
        RENTPROOF_DEMO_CASE_VERSION: "latest",
        RENTPROOF_LLM_MODE: "live",
      }),
      repositoryRoot: "C:\\work\\RentProof",
      userProfile: "C:\\Users\\Demo",
      localAppData: "C:\\Users\\Demo\\AppData\\Local",
      dependencies: dependencies({ isPortAvailable: vi.fn(async () => false) }),
    });

    expect(report.blocked).toBe(true);
    expect(byCode(report.items, "DEMO_SELECTION_INVALID")?.level).toBe("BLOCKED");
    expect(byCode(report.items, "LISTENER_PORT_IN_USE")?.level).toBe("BLOCKED");
    expect(byCode(report.items, "OPENAI_LIVE_CONFIGURATION_MISSING")?.level).toBe("BLOCKED");
  });

  it("maps dependency failures to safe typed blockers", async () => {
    const report = await checkDemoReadiness({
      profile: "local",
      environment: environment(),
      repositoryRoot: "C:\\work\\RentProof",
      userProfile: "C:\\Users\\Demo",
      localAppData: "C:\\Users\\Demo\\AppData\\Local",
      dependencies: dependencies({
        verifyToolchain: vi.fn(async () => {
          throw new Error("NODE_VERSION_MISMATCH");
        }),
        verifyGolden: vi.fn(async () => {
          throw new Error("secret lower-case detail");
        }),
        verifyRuntimeRoot: vi.fn(async () => {
          throw new Error("RUNTIME_REPARSE_POINT_DISALLOWED");
        }),
      }),
    });

    expect(byCode(report.items, "NODE_VERSION_MISMATCH")?.level).toBe("BLOCKED");
    expect(byCode(report.items, "DEMO_VERIFICATION_FAILED")?.level).toBe("BLOCKED");
    expect(byCode(report.items, "RUNTIME_REPARSE_POINT_DISALLOWED")?.level).toBe("BLOCKED");
    expect(JSON.stringify(report)).not.toContain("lower-case detail");
  });
});
