import { z } from "zod";
import { OpaqueIdSchema } from "@/domain/conversation";

const IsoTimestampSchema = z.iso.datetime({ offset: true });

export const CaseHistoryStatusSchema = z.enum(["draft", "analyzing", "needs_attention", "ready"]);

export const CaseHistorySummarySchema = z
  .object({
    caseId: OpaqueIdSchema,
    displayName: z.string().min(1).max(120),
    status: CaseHistoryStatusSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const CaseHistoryDetailSchema = CaseHistorySummarySchema.extend({
  revision: z.number().int().nonnegative(),
  sourceMode: z.enum(["fixture", "live"]),
  createdAt: IsoTimestampSchema,
}).strict();

export type CaseHistorySummary = z.infer<typeof CaseHistorySummarySchema>;
export type CaseHistoryDetail = z.infer<typeof CaseHistoryDetailSchema>;

export type HistoryAccessErrorCode =
  "HISTORY_AUTHENTICATION_REQUIRED" | "HISTORY_ACCOUNT_REQUIRED" | "HISTORY_NOT_FOUND_OR_FORBIDDEN";

export class HistoryAccessError extends Error {
  override readonly name = "HistoryAccessError";

  constructor(readonly code: HistoryAccessErrorCode) {
    super(code);
  }
}
