// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  REAL_DEMO_CLOUD_CONSENT_TEXT,
  REAL_DEMO_CLOUD_CONSENT_VERSION,
} from "@/application/real-demo";
import { createOcrConfirmation } from "@/application/ocr/confirm-ocr";
import { assessOcrProviderOutput } from "@/domain/ocr";
import type { ProcessingRecord } from "@/application/processing/contracts";
import { createPostgresRuntime } from "./runtime";
import { parsePostgresDatabaseConfig } from "./config";
import { PostgresRealDemoRepository } from "./real-demo-repository";
import { PostgresProcessingRepository } from "./processing-repository";
import { PostgresEvidenceBudgetRepository } from "./evidence-budget-repository";

it.runIf(process.env["RENTPROOF_PROCESSING_DB_SMOKE"] === "1")(
  "real PostgreSQL OCR confirmation race, owner isolation, budget replay and cleanup",
  async () => {
    const config = parsePostgresDatabaseConfig(process.env);
    if (config.environment !== "synthetic_demo" || config.role !== "app")
      throw new Error("SYNTHETIC_APP_DATABASE_REQUIRED");
    const runtime = createPostgresRuntime(config);
    const db = runtime.database;
    const suffix = randomBytes(12).toString("hex");
    const actor = {
      kind: "user",
      userId: `user_processing_${suffix}`,
      sessionId: `session_processing_${suffix}`,
    } as const;
    const artifactId = `artifact_processing_${suffix}`;
    let caseId: string | undefined;
    try {
      await db
        .insertInto("internal_users")
        .values({ id: actor.userId, clerk_user_id: null, email_verified: true, status: "active" })
        .execute();
      const now = new Date();
      await db
        .insertInto("auth_sessions")
        .values({
          id: actor.sessionId,
          user_id: actor.userId,
          token_digest: createHash("sha256").update(suffix).digest("hex"),
          created_at: now,
          last_used_at: now,
          idle_expires_at: new Date(now.getTime() + 600_000),
          reverified_until: null,
          revoked_at: null,
        })
        .execute();
      const realRepo = new PostgresRealDemoRepository(db);
      const policyHash = createHash("sha256").update(REAL_DEMO_CLOUD_CONSENT_TEXT).digest("hex");
      ({ caseId } = await realRepo.createCase({
        actor,
        displayName: "Synthetic processing transaction test",
        cloudProcessingConsentVersion: REAL_DEMO_CLOUD_CONSENT_VERSION,
        cloudProcessingConsentHash: policyHash,
        now,
      }));
      const processing = new PostgresProcessingRepository(db);
      const prepared = createOcrConfirmation({
        actor,
        caseId,
        artifactId,
        expectedRevision: 0,
        policyHash,
        confirmationId: `confirmation_${suffix}`,
        nowMs: now.getTime(),
        assessment: assessOcrProviderOutput(
          {
            pages: [
              {
                page: 1,
                quality: "clear",
                lines: [{ text: "虛構租金 12000 元", confidence: 1, bbox: [0, 0, 1, 1] }],
              },
            ],
          },
          1,
        ),
      });
      const stored = {
        originalRelativePath: `${caseId}/${artifactId}/original.enc`,
        extractedTextRelativePath: `${caseId}/${artifactId}/extracted-text.enc`,
        derivativeRelativePath: null,
        derivativeSha256: null,
        derivativeBytes: null,
      };
      const record: ProcessingRecord = {
        actor,
        reservation: {
          caseId,
          artifactId,
          kind: "contract_pdf",
          mime: "application/pdf",
          originalSha256: "a".repeat(64),
          originalBytes: 100,
        },
        expectedRevision: 0,
        policyHash,
        idempotencyHash: createHash("sha256").update(`idempotency:${suffix}`).digest("hex"),
        type: "contract.ocr",
        state: "queued",
        stored,
        confirmation: null,
        reasonCode: null,
        jobId: null,
      };
      await processing.create(record);
      const pending = {
        ...record,
        state: "requires_confirmation" as const,
        confirmation: prepared.confirmation,
      };
      await processing.replace(pending, "queued");
      const outcomes = await Promise.allSettled(
        [1, 2].map(() =>
          processing.finalize(pending, stored, {
            confirmationId: prepared.confirmation.confirmationId,
            pages: prepared.pages,
            nowMs: Date.now(),
          }),
        ),
      );
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect((await processing.find(actor, caseId, artifactId))?.confirmation?.state).toBe("used");
      expect(
        await db.selectFrom("case_artifacts").select("id").where("case_id", "=", caseId).execute(),
      ).toHaveLength(1);
      await expect(
        processing.find({ ...actor, userId: `user_other_${suffix}` }, caseId, artifactId),
      ).rejects.toThrow("REAL_DEMO_AUTH_REQUIRED");
      const first = new PostgresEvidenceBudgetRepository(db);
      const reservationId = `budget_${suffix}`;
      expect(
        await first.reserve({
          operationKind: "provider_request",
          caseId,
          reservationId,
          model: "gpt-5.6-terra",
          maximumProviderAttempts: 1,
          maximumInputTokens: 100,
          maximumOutputAndReasoningTokens: 100,
        }),
      ).toMatchObject({ ok: true });
      const restarted = new PostgresEvidenceBudgetRepository(db);
      expect(await restarted.get(caseId)).toMatchObject({ activeReservationCount: 1 });
      expect(
        await restarted.reconcile({
          reservationId,
          usage: { kind: "unknown", actualProviderAttempts: 1 },
        }),
      ).toMatchObject({ ok: true });
      expect(await new PostgresEvidenceBudgetRepository(db).get(caseId)).toMatchObject({
        unknownUsage: true,
      });
      await db
        .updateTable("auth_sessions")
        .set({ revoked_at: new Date() })
        .where("id", "=", actor.sessionId)
        .execute();
      await expect(processing.find(actor, caseId, artifactId)).rejects.toThrow(
        "REAL_DEMO_AUTH_REQUIRED",
      );
    } finally {
      try {
        if (caseId) {
          await db.deleteFrom("case_artifacts").where("case_id", "=", caseId).execute();
          await db.deleteFrom("policy_events").where("case_id", "=", caseId).execute();
          await db
            .deleteFrom("rental_cases")
            .where("id", "=", caseId)
            .where("owner_subject_id", "=", actor.userId)
            .execute();
          expect(
            await db
              .selectFrom("artifact_processing")
              .select("id")
              .where("case_id", "=", caseId)
              .execute(),
          ).toHaveLength(0);
          expect(
            await db
              .selectFrom("case_evidence_budgets")
              .select("case_id")
              .where("case_id", "=", caseId)
              .execute(),
          ).toHaveLength(0);
        }
        await db.deleteFrom("auth_sessions").where("id", "=", actor.sessionId).execute();
        await db.deleteFrom("internal_users").where("id", "=", actor.userId).execute();
      } finally {
        await runtime.close();
      }
    }
  },
  30_000,
);
