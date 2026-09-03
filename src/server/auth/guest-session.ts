import "server-only";
import type { ActorContext } from "@/application/repositories";
import { HmacOpaqueTokenService, parseAccountTokenKey } from "@/adapters/auth/self-hosted";
import {
  PostgresGuestSessionRepository,
  createPostgresRuntime,
  parsePostgresDatabaseConfig,
  type PostgresRuntime,
} from "@/adapters/database/postgres";

export const GUEST_SESSION_COOKIE = "__Host-rentproof_guest";

let runtimePromise: Promise<GuestSessionRuntime> | undefined;
let postgresRuntime: PostgresRuntime | undefined;

type GuestSessionRuntime = Readonly<{
  issue(): Promise<{ actor: ActorContext & { kind: "guest" }; rawToken: string }>;
  resolve(rawToken: string | undefined): Promise<(ActorContext & { kind: "guest" }) | null>;
}>;

export function getGuestSessionRuntime(): Promise<GuestSessionRuntime> {
  runtimePromise ??= compose();
  return runtimePromise;
}

async function compose(): Promise<GuestSessionRuntime> {
  const config = parsePostgresDatabaseConfig(process.env);
  if (config.environment !== "secure_demo" || config.role !== "app") {
    throw new Error("GUEST_SESSION_CONFIGURATION_INVALID");
  }
  const tokens = new HmacOpaqueTokenService(
    parseAccountTokenKey(process.env["RENTPROOF_AUTH_TOKEN_KEY"]),
  );
  postgresRuntime = createPostgresRuntime(config);
  const repository = new PostgresGuestSessionRepository(postgresRuntime.database);
  return {
    async issue() {
      const token = tokens.issue();
      return { actor: await repository.create(token.digest, new Date()), rawToken: token.rawToken };
    },
    resolve(rawToken) {
      if (!rawToken) return Promise.resolve(null);
      const digest = tokens.digest(rawToken);
      return digest ? repository.resolve(digest, new Date()) : Promise.resolve(null);
    },
  };
}

export async function closeGuestSessionRuntimeForTests(): Promise<void> {
  await postgresRuntime?.close();
  postgresRuntime = undefined;
  runtimePromise = undefined;
}
