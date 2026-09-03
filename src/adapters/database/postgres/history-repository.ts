import type { Kysely } from "kysely";
import {
  CaseHistoryDetailSchema,
  CaseHistorySummarySchema,
  type CaseHistoryDetail,
  type CaseHistoryRepository,
  type CaseHistorySummary,
} from "@/application/history";
import { ActorContextSchema, type ActorContext } from "@/application/repositories";
import { OpaqueIdSchema } from "@/domain/conversation";
import type { RentProofDatabase } from "./database";
import { PostgresRepositoryError } from "./repositories";

const VISIBLE_STATUSES = ["draft", "analyzing", "needs_attention", "ready"] as const;

export class PostgresCaseHistoryRepository implements CaseHistoryRepository {
  constructor(private readonly database: Kysely<RentProofDatabase>) {}

  async listOwned(actor: ActorContext): Promise<readonly CaseHistorySummary[]> {
    const user = parseUserActor(actor);
    const rows = await this.database
      .selectFrom("rental_cases")
      .select(["id", "display_name", "status", "updated_at"])
      .where("owner_type", "=", "user")
      .where("owner_subject_id", "=", user.userId)
      .where("deleted_at", "is", null)
      .where("status", "in", VISIBLE_STATUSES)
      .orderBy("updated_at", "desc")
      .limit(50)
      .execute();
    return rows.map((row) =>
      CaseHistorySummarySchema.parse({
        caseId: row.id,
        displayName: row.display_name,
        status: row.status,
        updatedAt: row.updated_at.toISOString(),
      }),
    );
  }

  async findOwned(actor: ActorContext, caseId: string): Promise<CaseHistoryDetail | null> {
    const user = parseUserActor(actor);
    const parsedCaseId = OpaqueIdSchema.safeParse(caseId);
    if (!parsedCaseId.success) {
      throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");
    }
    const row = await this.database
      .selectFrom("rental_cases")
      .select([
        "id",
        "display_name",
        "status",
        "revision",
        "source_mode",
        "created_at",
        "updated_at",
      ])
      .where("id", "=", parsedCaseId.data)
      .where("owner_type", "=", "user")
      .where("owner_subject_id", "=", user.userId)
      .where("deleted_at", "is", null)
      .where("status", "in", VISIBLE_STATUSES)
      .executeTakeFirst();
    if (!row) return null;
    return CaseHistoryDetailSchema.parse({
      caseId: row.id,
      displayName: row.display_name,
      status: row.status,
      revision: row.revision,
      sourceMode: row.source_mode,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }
}

function parseUserActor(actor: ActorContext): ActorContext & { kind: "user" } {
  const parsed = ActorContextSchema.safeParse(actor);
  if (!parsed.success || parsed.data.kind !== "user") {
    throw new PostgresRepositoryError("POSTGRES_REPOSITORY_INPUT_INVALID");
  }
  return parsed.data;
}
