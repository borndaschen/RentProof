import { z } from "zod";
import {
  AssistantCardSchema,
  AssistantTurnSchema,
  CONVERSATION_LIMITS,
  OpaqueIdSchema,
  unicodeCodePointLength,
} from "@/domain/conversation";

const ServerTemplateKeySchema = z.enum([
  "next_step",
  "clarification",
  "validation_error",
  "provider_error",
  "insufficient_information",
  "http_warning",
]);

const ExplanationCandidateSchema = z
  .object({
    text: z.string().min(1),
    grounding: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("source_refs"),
          sourceRefIds: z.array(OpaqueIdSchema).min(1).max(5),
        })
        .strict(),
      z
        .object({
          kind: z.literal("insufficient_information"),
          reasonCode: z.enum(["EXPLANATION_FACTS_INSUFFICIENT", "EXPLANATION_LOCATOR_UNAVAILABLE"]),
        })
        .strict(),
    ]),
  })
  .strict();

const SourceRefSchema = z
  .object({
    sourceRefId: OpaqueIdSchema,
    snapshotId: OpaqueIdSchema,
  })
  .strict();

const WorkspaceAreaSchema = z.enum(["summary", "evidence_matrix", "contract", "report"]);

const ComposeAssistantResponseInputSchema = z
  .object({
    turnId: OpaqueIdSchema,
    caseRevision: z.number().int().nonnegative(),
    snapshotId: OpaqueIdSchema.nullable(),
    serverTemplateKeys: z.array(ServerTemplateKeySchema).max(6),
    explanationSegments: z.array(ExplanationCandidateSchema).max(6),
    serverCards: z.array(AssistantCardSchema).max(100),
    availableSourceRefs: z.array(SourceRefSchema).max(100),
    remainingWorkspaceArea: WorkspaceAreaSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.serverTemplateKeys).size !== input.serverTemplateKeys.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_SERVER_TEMPLATE" });
    }
    if (new Set(input.serverCards.map((card) => card.cardId)).size !== input.serverCards.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_ASSISTANT_CARD" });
    }
    if (
      new Set(input.availableSourceRefs.map((ref) => ref.sourceRefId)).size !==
      input.availableSourceRefs.length
    ) {
      context.addIssue({ code: "custom", message: "DUPLICATE_SOURCE_REF" });
    }
  });

export type ComposeAssistantResponseInput = z.input<typeof ComposeAssistantResponseInputSchema>;

export type ComposeAssistantResponseResult =
  | { ok: true; turn: z.infer<typeof AssistantTurnSchema> }
  | {
      ok: false;
      code:
        | "ASSISTANT_OUTPUT_SCHEMA_INVALID"
        | "EXPLANATION_SOURCE_INVALID"
        | "EXPLANATION_FORBIDDEN_PHRASE";
    };

const SERVER_TEMPLATE_TEXT: Readonly<Record<z.infer<typeof ServerTemplateKeySchema>, string>> =
  Object.freeze({
    next_step: "請依目前案件狀態完成下一步；需要修改資料時，系統會先顯示確認卡。",
    clarification: "目前資訊不足以唯一判斷你的指涉，請指定要查看的項目。",
    validation_error: "輸入未通過驗證，案件內容沒有變更。",
    provider_error: "AI 說明目前無法完成；既有證據與案件狀態沒有因此改變。",
    insufficient_information: "目前資料不足，請查看待確認事項與來源證據。",
    http_warning: "目前為 HTTP 區域網路開發模式，請勿輸入真實個資或機密資料。",
  });

const PRIORITY: Readonly<Record<z.infer<typeof AssistantCardSchema>["priorityClass"], number>> =
  Object.freeze({
    blocking_security: 0,
    stop_and_verify: 1,
    pending_confirmation: 2,
    current_next_step: 3,
    evidence: 4,
  });

const FORBIDDEN_EXPLANATION_PATTERNS: readonly RegExp[] = [
  /(?:違法|非法)/u,
  /(?:確定|就是|是|屬於|構成|可能是|疑似|看起來像|應該是)詐騙/u,
  /(?:詐騙|違法)(?:機率|概率|分數)/u,
  /(?:安全無虞|可以放心(?:簽約|付款)|保證安全)/u,
  /(?:房東|房客|租客|仲介)(?:應負責|有責任|需賠償)/u,
  /(?:責任歸屬|法律責任已確定)/u,
  /(?:請|務必|立刻|立即|建議|可以)(?:上傳|補拍|付款|匯款|轉帳|簽約|點擊|按下|修改|刪除|聯絡|報警|停止付款)/u,
  /(?:點擊|按下)(?:確認|連結|按鈕)/u,
];

export class HybridAssistantResponseComposer {
  compose(untrustedInput: unknown): ComposeAssistantResponseResult {
    const parsed = ComposeAssistantResponseInputSchema.safeParse(untrustedInput);
    if (!parsed.success) {
      return { ok: false, code: "ASSISTANT_OUTPUT_SCHEMA_INVALID" };
    }
    const input = parsed.data;

    if (input.serverTemplateKeys.length + input.explanationSegments.length > 6) {
      return { ok: false, code: "ASSISTANT_OUTPUT_SCHEMA_INVALID" };
    }

    const sourceRefs = new Map(input.availableSourceRefs.map((ref) => [ref.sourceRefId, ref]));
    const explanations = [];
    for (const explanation of input.explanationSegments) {
      const text = explanation.text.normalize("NFC");
      if (containsForbiddenExplanationWording(text)) {
        return { ok: false, code: "EXPLANATION_FORBIDDEN_PHRASE" };
      }
      if (explanation.grounding.kind === "source_refs") {
        if (
          input.snapshotId === null ||
          explanation.grounding.sourceRefIds.some(
            (sourceRefId) => sourceRefs.get(sourceRefId)?.snapshotId !== input.snapshotId,
          )
        ) {
          return { ok: false, code: "EXPLANATION_SOURCE_INVALID" };
        }
      }
      explanations.push({
        kind: "ai_explanation" as const,
        text,
        grounding: explanation.grounding,
      });
    }

    if (
      input.serverCards.some(
        (card) => card.snapshotId !== null && card.snapshotId !== input.snapshotId,
      )
    ) {
      return { ok: false, code: "EXPLANATION_SOURCE_INVALID" };
    }

    const sortedCards = input.serverCards
      .map((card, index) => ({ card, index }))
      .sort(
        (left, right) =>
          PRIORITY[left.card.priorityClass] - PRIORITY[right.card.priorityClass] ||
          left.index - right.index,
      )
      .map(({ card }) => card);
    const cards = sortedCards.slice(0, CONVERSATION_LIMITS.assistantCards);
    const remainingItemCount = sortedCards.length - cards.length;
    const segments = [
      ...input.serverTemplateKeys.map((templateKey) => ({
        kind: "server_message" as const,
        templateKey,
        text: SERVER_TEMPLATE_TEXT[templateKey],
      })),
      ...explanations,
    ];

    if (
      unicodeCodePointLength(segments.map((segment) => segment.text).join("")) >
      CONVERSATION_LIMITS.assistantNarrativeCodePoints
    ) {
      return { ok: false, code: "ASSISTANT_OUTPUT_SCHEMA_INVALID" };
    }

    const turn = AssistantTurnSchema.safeParse({
      schemaVersion: "rentproof.assistant-turn.v1",
      turnId: input.turnId,
      caseRevision: input.caseRevision,
      snapshotId: input.snapshotId,
      segments,
      cards,
      remainingItemCount,
      workspaceAction:
        remainingItemCount > 0
          ? {
              area: input.remainingWorkspaceArea,
              labelKey: "view_evidence_workspace",
            }
          : null,
    });
    if (!turn.success) {
      return { ok: false, code: "ASSISTANT_OUTPUT_SCHEMA_INVALID" };
    }
    return { ok: true, turn: turn.data };
  }
}

function containsForbiddenExplanationWording(text: string): boolean {
  return FORBIDDEN_EXPLANATION_PATTERNS.some((pattern) => pattern.test(text));
}
