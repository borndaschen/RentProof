import "server-only";
import { SelfHostedAuthService } from "@/application/auth";
import {
  createInstalledArgon2idPasswordHasher,
  HmacOpaqueTokenService,
  LocalSyntheticPasswordResetOutbox,
  MinimumResponseFloor,
  parseAccountTokenKey,
} from "@/adapters/auth/self-hosted";
import {
  PostgresSelfHostedAuthRepository,
  createPostgresRuntime,
  parsePostgresDatabaseConfig,
  type PostgresRuntime,
} from "@/adapters/database/postgres";
import { getServerEnvironment } from "@/server/env";
import { isSelfHostedAuthRouteEnabled } from "./request-guard";

export type SelfHostedAuthRuntime = Readonly<{
  service: SelfHostedAuthService;
  outbox: LocalSyntheticPasswordResetOutbox;
  digestPreAuthContext(rawToken: string): string | null;
}>;

export class AuthRuntimeConfigurationError extends Error {
  override readonly name = "AuthRuntimeConfigurationError";
}

let runtimePromise: Promise<SelfHostedAuthRuntime> | undefined;
let postgresRuntime: PostgresRuntime | undefined;

export function getSelfHostedAuthRuntime(): Promise<SelfHostedAuthRuntime> {
  runtimePromise ??= composeRuntime();
  return runtimePromise;
}

async function composeRuntime(): Promise<SelfHostedAuthRuntime> {
  const environment = getServerEnvironment();
  if (!isSelfHostedAuthRouteEnabled(environment)) {
    throw new AuthRuntimeConfigurationError("AUTH_FEATURE_DISABLED");
  }
  if (process.env["RENTPROOF_DATABASE_ADAPTER"] !== "postgres") {
    throw new AuthRuntimeConfigurationError("AUTH_DATABASE_UNCONFIGURED");
  }
  const config = parsePostgresDatabaseConfig(process.env);
  if (config.role !== "app") throw new AuthRuntimeConfigurationError("AUTH_DATABASE_ROLE_INVALID");
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE === "local_development" &&
    config.environment !== "synthetic_demo"
  ) {
    throw new AuthRuntimeConfigurationError("AUTH_SYNTHETIC_DATABASE_REQUIRED");
  }

  const passwords = createInstalledArgon2idPasswordHasher();
  let tokens: HmacOpaqueTokenService;
  try {
    tokens = new HmacOpaqueTokenService(
      parseAccountTokenKey(process.env["RENTPROOF_AUTH_TOKEN_KEY"]),
    );
  } catch {
    throw new AuthRuntimeConfigurationError("AUTH_TOKEN_KEY_INVALID");
  }
  const outbox = new LocalSyntheticPasswordResetOutbox();
  const dummyPasswordHash = await passwords.hash(`dummy-${tokens.issue().rawToken}`);
  postgresRuntime = createPostgresRuntime(config);
  return {
    service: new SelfHostedAuthService(
      new PostgresSelfHostedAuthRepository(postgresRuntime.database),
      passwords,
      tokens,
      outbox,
      { now: () => new Date() },
      dummyPasswordHash,
      new MinimumResponseFloor(500),
    ),
    outbox,
    digestPreAuthContext: (rawToken) => tokens.digest(rawToken),
  };
}

export async function closeSelfHostedAuthRuntimeForTests(): Promise<void> {
  await postgresRuntime?.close();
  postgresRuntime = undefined;
  runtimePromise = undefined;
}
