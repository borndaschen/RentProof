import { sql } from "kysely";
import {
  parsePostgresDatabaseConfig,
  PostgresConfigurationError,
} from "../src/adapters/database/postgres/config.ts";
import { createPostgresRuntime } from "../src/adapters/database/postgres/runtime.ts";

class AuthResidueError extends Error {
  override readonly name = "AuthResidueError";
  readonly code: "AUTH_HTTP_RESIDUE_APP_ROLE_REQUIRED" | "AUTH_HTTP_SYNTHETIC_RESIDUE_DETECTED";

  constructor(code: AuthResidueError["code"]) {
    super(code);
    this.code = code;
  }
}

async function main(): Promise<void> {
  const config = parsePostgresDatabaseConfig(process.env);
  if (config.role !== "app" || config.environment !== "synthetic_demo") {
    throw new AuthResidueError("AUTH_HTTP_RESIDUE_APP_ROLE_REQUIRED");
  }
  const postgres = createPostgresRuntime(config);
  try {
    const result = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM (
        SELECT credentials.user_id, 'credential' AS kind
        FROM rentproof.auth_credentials AS credentials
        WHERE credentials.email_normalized LIKE 'synthetic-auth-%@example.test'
        UNION ALL
        SELECT sessions.user_id, 'session' AS kind
        FROM rentproof.auth_sessions AS sessions
        INNER JOIN rentproof.auth_credentials AS credentials ON credentials.user_id = sessions.user_id
        WHERE credentials.email_normalized LIKE 'synthetic-auth-%@example.test'
        UNION ALL
        SELECT resets.user_id, 'reset' AS kind
        FROM rentproof.auth_password_reset_challenges AS resets
        INNER JOIN rentproof.auth_credentials AS credentials ON credentials.user_id = resets.user_id
        WHERE credentials.email_normalized LIKE 'synthetic-auth-%@example.test'
        UNION ALL
        SELECT verifications.user_id, 'verification' AS kind
        FROM rentproof.auth_email_verification_challenges AS verifications
        INNER JOIN rentproof.auth_credentials AS credentials ON credentials.user_id = verifications.user_id
        WHERE credentials.email_normalized LIKE 'synthetic-auth-%@example.test'
      ) AS residues
    `.execute(postgres.database);
    if (Number(result.rows[0]?.count ?? "-1") !== 0) {
      throw new AuthResidueError("AUTH_HTTP_SYNTHETIC_RESIDUE_DETECTED");
    }
    process.stdout.write("AUTH_HTTP_SYNTHETIC_RESIDUE_ZERO\n");
  } finally {
    await postgres.close();
  }
}

try {
  await main();
} catch (error: unknown) {
  const reason =
    error instanceof PostgresConfigurationError || error instanceof AuthResidueError
      ? error.code
      : "AUTH_HTTP_SYNTHETIC_RESIDUE_CHECK_FAILED";
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}
