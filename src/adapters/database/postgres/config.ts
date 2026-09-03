import { z } from "zod";

export type PostgresDatabaseConfig = {
  connectionString: string;
  role: "app" | "migration";
  environment: "synthetic_demo" | "local_test" | "production";
  maxConnections: number;
};

export class PostgresConfigurationError extends Error {
  override readonly name = "PostgresConfigurationError";
  readonly code:
    | "POSTGRES_CONFIGURATION_INVALID"
    | "POSTGRES_REMOTE_ENDPOINT_FORBIDDEN"
    | "POSTGRES_SYNTHETIC_GATE_REQUIRED"
    | "POSTGRES_TLS_REQUIRED";

  constructor(code: PostgresConfigurationError["code"]) {
    super(code);
    this.code = code;
  }
}

const InputSchema = z
  .object({
    RENTPROOF_DATABASE_ADAPTER: z.literal("postgres"),
    RENTPROOF_DATABASE_URL: z.string().min(1),
    RENTPROOF_DATABASE_ROLE: z.enum(["app", "migration"]),
    RENTPROOF_DATABASE_ENVIRONMENT: z.enum(["synthetic_demo", "local_test", "production"]),
    RENTPROOF_DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20),
    RENTPROOF_DEPLOYMENT_PROFILE: z.enum(["local_development", "lan_development", "production"]),
    RENTPROOF_ALLOW_REAL_DATA: z.enum(["true", "false"]),
    RENTPROOF_PUBLIC_ORIGIN: z.url(),
  })
  .strict();

export function parsePostgresDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): PostgresDatabaseConfig {
  const parsed = InputSchema.safeParse({
    RENTPROOF_DATABASE_ADAPTER: environment["RENTPROOF_DATABASE_ADAPTER"],
    RENTPROOF_DATABASE_URL: environment["RENTPROOF_DATABASE_URL"],
    RENTPROOF_DATABASE_ROLE: environment["RENTPROOF_DATABASE_ROLE"],
    RENTPROOF_DATABASE_ENVIRONMENT: environment["RENTPROOF_DATABASE_ENVIRONMENT"],
    RENTPROOF_DATABASE_MAX_CONNECTIONS: environment["RENTPROOF_DATABASE_MAX_CONNECTIONS"],
    RENTPROOF_DEPLOYMENT_PROFILE: environment["RENTPROOF_DEPLOYMENT_PROFILE"],
    RENTPROOF_ALLOW_REAL_DATA: environment["RENTPROOF_ALLOW_REAL_DATA"],
    RENTPROOF_PUBLIC_ORIGIN: environment["RENTPROOF_PUBLIC_ORIGIN"],
  });
  if (!parsed.success) {
    throw new PostgresConfigurationError("POSTGRES_CONFIGURATION_INVALID");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(parsed.data.RENTPROOF_DATABASE_URL);
  } catch {
    throw new PostgresConfigurationError("POSTGRES_CONFIGURATION_INVALID");
  }
  if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
    throw new PostgresConfigurationError("POSTGRES_CONFIGURATION_INVALID");
  }
  if (
    !databaseUrl.username ||
    !databaseUrl.password ||
    databaseUrl.search ||
    databaseUrl.hash ||
    databaseUrl.pathname.includes("%")
  ) {
    throw new PostgresConfigurationError("POSTGRES_CONFIGURATION_INVALID");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!localHosts.has(databaseUrl.hostname)) {
    throw new PostgresConfigurationError("POSTGRES_REMOTE_ENDPOINT_FORBIDDEN");
  }

  const isProduction = parsed.data.RENTPROOF_DATABASE_ENVIRONMENT === "production";
  if (isProduction) {
    if (
      parsed.data.RENTPROOF_DEPLOYMENT_PROFILE !== "production" ||
      parsed.data.RENTPROOF_ALLOW_REAL_DATA !== "true"
    ) {
      throw new PostgresConfigurationError("POSTGRES_CONFIGURATION_INVALID");
    }
    if (new URL(parsed.data.RENTPROOF_PUBLIC_ORIGIN).protocol !== "https:") {
      throw new PostgresConfigurationError("POSTGRES_TLS_REQUIRED");
    }
  } else if (
    parsed.data.RENTPROOF_ALLOW_REAL_DATA !== "false" ||
    !/^\/rentproof_(?:demo|test)(?:_[a-z0-9]+)*$/u.test(databaseUrl.pathname)
  ) {
    throw new PostgresConfigurationError("POSTGRES_SYNTHETIC_GATE_REQUIRED");
  }

  return {
    connectionString: parsed.data.RENTPROOF_DATABASE_URL,
    role: parsed.data.RENTPROOF_DATABASE_ROLE,
    environment: parsed.data.RENTPROOF_DATABASE_ENVIRONMENT,
    maxConnections: parsed.data.RENTPROOF_DATABASE_MAX_CONNECTIONS,
  };
}
