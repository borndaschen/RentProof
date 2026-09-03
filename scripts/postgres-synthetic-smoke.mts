import { createHash, randomUUID } from "node:crypto";
import {
  parsePostgresDatabaseConfig,
  PostgresConfigurationError,
} from "../src/adapters/database/postgres/config.ts";
import { createPostgresRuntime } from "../src/adapters/database/postgres/runtime.ts";

class SyntheticSmokeError extends Error {
  override readonly name = "SyntheticSmokeError";
  readonly code:
    | "POSTGRES_SYNTHETIC_SMOKE_APP_ROLE_REQUIRED"
    | "POSTGRES_SYNTHETIC_SMOKE_ASSERTION_FAILED"
    | "POSTGRES_SYNTHETIC_SMOKE_CLEANUP_FAILED";

  constructor(code: SyntheticSmokeError["code"]) {
    super(code);
    this.code = code;
  }
}

function assertSmoke(condition: boolean): asserts condition {
  if (!condition) throw new SyntheticSmokeError("POSTGRES_SYNTHETIC_SMOKE_ASSERTION_FAILED");
}

async function main(): Promise<void> {
  const config = parsePostgresDatabaseConfig(process.env);
  if (config.role !== "app" || config.environment !== "synthetic_demo") {
    throw new SyntheticSmokeError("POSTGRES_SYNTHETIC_SMOKE_APP_ROLE_REQUIRED");
  }

  const suffix = randomUUID().replaceAll("-", "");
  const ownerAId = `user_smoke_a_${suffix}`;
  const ownerBId = `user_smoke_b_${suffix}`;
  const caseId = `case_smoke_${suffix}`;
  const sessionId = `session_smoke_${suffix}`;
  const resetId = `reset_smoke_${suffix}`;
  const verificationId = `verification_smoke_${suffix}`;
  const email = `synthetic-${suffix}@example.invalid`;
  const digest = (scope: string): string =>
    createHash("sha256").update(`${scope}:${suffix}`).digest("hex");
  const now = new Date();
  const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1_000);
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);
  const runtime = createPostgresRuntime(config);
  let smokeFailure: unknown;

  try {
    try {
      await runtime.database.transaction().execute(async (transaction) => {
        try {
          await transaction
            .insertInto("internal_users")
            .values([
              {
                id: ownerAId,
                clerk_user_id: null,
                email_verified: true,
                status: "active",
              },
              {
                id: ownerBId,
                clerk_user_id: null,
                email_verified: true,
                status: "active",
              },
            ])
            .execute();
          await transaction
            .insertInto("rental_cases")
            .values({
              id: caseId,
              owner_type: "user",
              owner_subject_id: ownerAId,
              display_name: "Synthetic smoke case",
              status: "draft",
              revision: 0,
              active_snapshot_id: null,
              state: { synthetic: true, phase: "created" },
              source_mode: "fixture",
              deleted_at: null,
            })
            .execute();
          await transaction
            .insertInto("auth_credentials")
            .values({
              user_id: ownerAId,
              email_normalized: email,
              password_hash: "$argon2id$synthetic-smoke-not-a-real-password-hash",
              password_updated_at: now,
              email_verified_at: now,
            })
            .execute();
          await transaction
            .insertInto("auth_sessions")
            .values({
              id: sessionId,
              user_id: ownerAId,
              token_digest: digest("session"),
              created_at: now,
              last_used_at: now,
              idle_expires_at: sevenDaysLater,
              reverified_until: null,
              revoked_at: null,
            })
            .execute();
          await transaction
            .insertInto("auth_password_reset_challenges")
            .values({
              id: resetId,
              user_id: ownerAId,
              token_digest: digest("reset"),
              created_at: now,
              expires_at: tenMinutesLater,
              consumed_at: null,
            })
            .execute();
          await transaction
            .insertInto("auth_email_verification_challenges")
            .values({
              id: verificationId,
              user_id: ownerAId,
              token_digest: digest("verification"),
              created_at: now,
              expires_at: tenMinutesLater,
              consumed_at: null,
            })
            .execute();

          const authJoin = await transaction
            .selectFrom("auth_sessions")
            .innerJoin("auth_credentials", "auth_credentials.user_id", "auth_sessions.user_id")
            .select(["auth_sessions.user_id", "auth_sessions.idle_expires_at"])
            .where("auth_sessions.token_digest", "=", digest("session"))
            .where("auth_sessions.revoked_at", "is", null)
            .where("auth_sessions.idle_expires_at", ">", now)
            .executeTakeFirst();
          assertSmoke(authJoin?.user_id === ownerAId);
          assertSmoke(authJoin.idle_expires_at.getTime() === sevenDaysLater.getTime());

          const ownerBAuthDenied = await transaction
            .selectFrom("auth_sessions")
            .select("id")
            .where("token_digest", "=", digest("session"))
            .where("user_id", "=", ownerBId)
            .executeTakeFirst();
          assertSmoke(ownerBAuthDenied === undefined);

          const ownerAList = await transaction
            .selectFrom("rental_cases")
            .select("id")
            .where("owner_type", "=", "user")
            .where("owner_subject_id", "=", ownerAId)
            .where("deleted_at", "is", null)
            .execute();
          assertSmoke(ownerAList.length === 1 && ownerAList[0]?.id === caseId);

          const ownerADetail = await transaction
            .selectFrom("rental_cases")
            .select(["id", "revision", "state"])
            .where("id", "=", caseId)
            .where("owner_type", "=", "user")
            .where("owner_subject_id", "=", ownerAId)
            .where("deleted_at", "is", null)
            .executeTakeFirst();
          assertSmoke(ownerADetail?.id === caseId && ownerADetail.revision === 0);
          assertSmoke(
            typeof ownerADetail?.state === "object" &&
              ownerADetail.state !== null &&
              "synthetic" in ownerADetail.state &&
              ownerADetail.state.synthetic === true,
          );

          const ownerBDenied = await transaction
            .selectFrom("rental_cases")
            .select("id")
            .where("id", "=", caseId)
            .where("owner_type", "=", "user")
            .where("owner_subject_id", "=", ownerBId)
            .where("deleted_at", "is", null)
            .executeTakeFirst();
          assertSmoke(ownerBDenied === undefined);

          const saved = await transaction
            .updateTable("rental_cases")
            .set({ revision: 1, state: { synthetic: true, phase: "updated" } })
            .where("id", "=", caseId)
            .where("owner_type", "=", "user")
            .where("owner_subject_id", "=", ownerAId)
            .where("deleted_at", "is", null)
            .where("revision", "=", 0)
            .returning("revision")
            .executeTakeFirst();
          assertSmoke(saved?.revision === 1);

          const staleWrite = await transaction
            .updateTable("rental_cases")
            .set({ revision: 1 })
            .where("id", "=", caseId)
            .where("owner_type", "=", "user")
            .where("owner_subject_id", "=", ownerAId)
            .where("revision", "=", 0)
            .returning("revision")
            .executeTakeFirst();
          assertSmoke(staleWrite === undefined);

          const ownerBWrite = await transaction
            .updateTable("rental_cases")
            .set({ revision: 2 })
            .where("id", "=", caseId)
            .where("owner_type", "=", "user")
            .where("owner_subject_id", "=", ownerBId)
            .where("revision", "=", 1)
            .returning("revision")
            .executeTakeFirst();
          assertSmoke(ownerBWrite === undefined);
        } finally {
          await transaction.deleteFrom("rental_cases").where("id", "=", caseId).execute();
          await transaction
            .deleteFrom("internal_users")
            .where("id", "in", [ownerAId, ownerBId])
            .execute();
        }
      });
    } catch (error: unknown) {
      smokeFailure = error;
    }

    const remainingCases = await runtime.database
      .selectFrom("rental_cases")
      .select("id")
      .where("id", "=", caseId)
      .execute();
    const remainingUsers = await runtime.database
      .selectFrom("internal_users")
      .select("id")
      .where("id", "in", [ownerAId, ownerBId])
      .execute();
    const remainingSessions = await runtime.database
      .selectFrom("auth_sessions")
      .select("id")
      .where("id", "=", sessionId)
      .execute();
    const remainingResetChallenges = await runtime.database
      .selectFrom("auth_password_reset_challenges")
      .select("id")
      .where("id", "=", resetId)
      .execute();
    const remainingVerificationChallenges = await runtime.database
      .selectFrom("auth_email_verification_challenges")
      .select("id")
      .where("id", "=", verificationId)
      .execute();
    if (
      remainingCases.length !== 0 ||
      remainingUsers.length !== 0 ||
      remainingSessions.length !== 0 ||
      remainingResetChallenges.length !== 0 ||
      remainingVerificationChallenges.length !== 0
    ) {
      throw new SyntheticSmokeError("POSTGRES_SYNTHETIC_SMOKE_CLEANUP_FAILED");
    }
    if (smokeFailure !== undefined) throw smokeFailure;
    process.stdout.write("POSTGRES_SYNTHETIC_SMOKE_OK\n");
  } finally {
    await runtime.close();
  }
}

try {
  await main();
} catch (error: unknown) {
  const reason =
    error instanceof PostgresConfigurationError || error instanceof SyntheticSmokeError
      ? error.code
      : "POSTGRES_SYNTHETIC_SMOKE_FAILED";
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}
