import "server-only";
import { HybridAssistantResponseComposer } from "@/application/conversation/assistant";
import { AssistantTurnSchema, type ConversationErrorCode } from "@/domain/conversation";

const ids = {
  turn: "turn_fixture_000000000001",
  card: "card_fixture_000000000001",
  focus: "focus_fixture_00000000001",
  snapshot: "snapshot_fixture_0000001",
};
const responseComposer = new HybridAssistantResponseComposer();

export function createFixtureAssistantTurn(text: string): unknown {
  const normalized = text.normalize("NFC");
  const explicitInjection =
    /(忽略.{0,8}(之前|以上)|system\s*prompt|run\s*stage|執行.{0,4}(工具|命令))/iu.test(normalized);

  if (explicitInjection) {
    const composed = responseComposer.compose({
      turnId: ids.turn,
      caseRevision: 1,
      snapshotId: ids.snapshot,
      serverTemplateKeys: ["validation_error"],
      explanationSegments: [],
      serverCards: [],
      availableSourceRefs: [],
      remainingWorkspaceArea: "summary",
    });
    if (!composed.ok) throw new Error(composed.code);
    return composed.turn;
  }

  const asksWhy = /(為什麼|原因|怎麼判斷)/u.test(normalized);
  const composed = responseComposer.compose({
    turnId: ids.turn,
    caseRevision: 1,
    snapshotId: ids.snapshot,
    serverTemplateKeys: asksWhy ? [] : ["next_step"],
    explanationSegments: asksWhy
      ? [
          {
            text: "因為看屋影像沒有涵蓋洗衣機位置，契約附件也未列出設備。這只能表示目前證據不足，不能推論現場沒有洗衣機。",
            grounding: { kind: "source_refs", sourceRefIds: [ids.focus] },
          },
        ]
      : [],
    serverCards: [
      {
        cardType: "finding",
        cardId: ids.card,
        focusRefId: ids.focus,
        snapshotId: ids.snapshot,
        priorityClass: "evidence",
        title: "洗衣機承諾：證據不足",
        description: "未拍到不等於不存在；需要補拍或補列契約附件。",
      },
    ],
    availableSourceRefs: [{ sourceRefId: ids.focus, snapshotId: ids.snapshot }],
    remainingWorkspaceArea: "evidence_matrix",
  });
  if (!composed.ok) throw new Error(composed.code);
  return AssistantTurnSchema.parse({
    ...composed.turn,
    remainingItemCount: 2,
    workspaceAction: { area: "evidence_matrix", labelKey: "view_evidence_workspace" },
  });
}

export function toConversationError(code: ConversationErrorCode | string, status = 400): Response {
  return Response.json(
    { error: { code, message: "無法處理這則訊息。請檢查內容後再試一次。", retryable: false } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function toPiiWarning(input: {
  acknowledgementId: string;
  expiresAt: string;
  piiKinds: readonly string[];
}): Response {
  return Response.json(
    {
      error: {
        code: "PII_WARNING_REQUIRED",
        message: "這段文字可能包含個人資料。HTTP 傳輸可能被讀取；請修改內容或明確確認仍要送出。",
        retryable: true,
      },
      acknowledgement: input,
    },
    { status: 409, headers: { "Cache-Control": "private, no-store" } },
  );
}
