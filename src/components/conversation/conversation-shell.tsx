"use client";

import { type FormEvent, type KeyboardEvent, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowUp, FileSearch, ShieldAlert } from "lucide-react";
import { z } from "zod";
import {
  AssistantTurnSchema,
  MaterialCandidatePayloadSchema,
  type AssistantTurn,
  type MaterialCandidatePayload,
} from "@/domain/conversation";
import { GoldenUploadPanel } from "@/components/uploads";
import type { RuntimeStatusProjection } from "@/server/runtime-status";

const maxCodePoints = 2_000;
const PiiWarningResponseSchema = z
  .object({
    error: z.object({ code: z.literal("PII_WARNING_REQUIRED") }).passthrough(),
    acknowledgement: z
      .object({
        acknowledgementId: z.string().min(20).max(128),
        expiresAt: z.iso.datetime({ offset: true }),
        piiKinds: z.array(z.string()).max(8),
      })
      .strict(),
  })
  .passthrough();

const IssueConfirmationResponseSchema = z
  .object({
    ok: z.literal(true),
    confirmationId: z.string().min(20).max(128),
    csrfToken: z.string().min(20).max(128),
    expiresAt: z.iso.datetime({ offset: true }),
    candidate: MaterialCandidatePayloadSchema,
    caseRevision: z.number().int().nonnegative(),
  })
  .strict();

type PendingConfirmationUi = z.infer<typeof IssueConfirmationResponseSchema>;
const ConsumeConfirmationResponseSchema = z
  .object({ ok: z.literal(true), revision: z.number().int().positive() })
  .strict();

type PendingPiiWarning = {
  requestId: string;
  userText: string;
  acknowledgementId: string;
  expiresAt: string;
  piiKinds: readonly string[];
};

function codePointLength(value: string): number {
  return [...value.normalize("NFC")].length;
}

function candidateSummary(candidate: MaterialCandidatePayload): string {
  if (candidate.candidateType === "update_case_profile") {
    return candidate.changes
      .map((change) => {
        if (change.field === "electricity_payer") return "電費負擔人：房客";
        if (change.field === "residential_lease") return "住宅租賃範圍";
        if (change.field === "intended_lease_months") return "預計租期";
        return "預計簽約日";
      })
      .join("、");
  }
  return "付款與看屋時間線";
}

function PendingConfirmationCard({
  value,
  onApplied,
}: {
  value: PendingConfirmationUi;
  onApplied?: (revision: number) => void;
}) {
  const [status, setStatus] = useState<"pending" | "saving" | "applied" | "failed">("pending");
  const [revision, setRevision] = useState<number | null>(null);

  async function confirm() {
    setStatus("saving");
    try {
      const response = await fetch(
        `/api/cases/golden-v1/confirmations/${encodeURIComponent(value.confirmationId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": value.csrfToken,
          },
          body: "{}",
        },
      );
      const parsed = ConsumeConfirmationResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("CONFIRMATION_CONSUME_FAILED");
      setRevision(parsed.data.revision);
      setStatus("applied");
      onApplied?.(parsed.data.revision);
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="confirmation-panel">
      <strong>{candidateSummary(value.candidate)}</strong>
      <span>確認期限：{new Date(value.expiresAt).toLocaleTimeString("zh-TW")}</span>
      {status === "applied" ? (
        <p role="status">已確認並寫入案件修訂 {revision}。</p>
      ) : (
        <div className="card-actions">
          <button
            className="primary-button"
            type="button"
            onClick={confirm}
            disabled={status === "saving"}
          >
            {status === "saving" ? "寫入中" : "確認並加入案件"}
          </button>
          {status === "failed" ? <span role="alert">確認失敗；案件內容沒有變更。</span> : null}
        </div>
      )}
    </div>
  );
}

export function ConversationShell({ runtimeStatus }: { runtimeStatus: RuntimeStatusProjection }) {
  const [draft, setDraft] = useState("");
  const [submittedTurns, setSubmittedTurns] = useState<
    readonly { id: string; userText: string; assistant: AssistantTurn }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [piiWarning, setPiiWarning] = useState<PendingPiiWarning | null>(null);
  const [fixtureConfirmation, setFixtureConfirmation] = useState<PendingConfirmationUi | null>(
    null,
  );
  const [fixtureAppliedRevision, setFixtureAppliedRevision] = useState<number | null>(null);
  const [fixtureConfirmationError, setFixtureConfirmationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const count = useMemo(() => codePointLength(draft), [draft]);
  const overLimit = count > maxCodePoints;

  async function submitTurn(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!draft || overLimit || isSubmitting) return;

    const userText = draft.normalize("NFC");
    const requestId = crypto.randomUUID();
    await sendTurn(userText, requestId);
  }

  async function sendTurn(userText: string, requestId: string, acknowledgementId?: string) {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/cases/golden-v1/conversation/turns", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Idempotency-Key": requestId,
          ...(acknowledgementId ? { "PII-Acknowledgement": acknowledgementId } : {}),
        },
        body: userText,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const warning = PiiWarningResponseSchema.safeParse(payload);
        if (warning.success) {
          setPiiWarning({ requestId, userText, ...warning.data.acknowledgement });
          return;
        }
        setError("這則訊息目前無法處理。內容已保留，請稍後再試。");
        return;
      }
      const parsed = AssistantTurnSchema.safeParse(payload);
      if (!parsed.success) {
        setError("系統回覆未通過結構驗證，沒有寫入案件。");
        return;
      }
      setSubmittedTurns((turns) => [...turns, { id: requestId, userText, assistant: parsed.data }]);
      setDraft("");
      setPiiWarning(null);
    } catch {
      setError("連線中斷。內容已保留，請確認 Server 狀態後重試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmPiiWarning() {
    if (!piiWarning) return;
    await sendTurn(piiWarning.userText, piiWarning.requestId, piiWarning.acknowledgementId);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function issueFixtureConfirmation() {
    setFixtureConfirmationError(null);
    try {
      const response = await fetch("/api/cases/golden-v1/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateKey: "fixture_electricity_payer_tenant" }),
      });
      const parsed = IssueConfirmationResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("CONFIRMATION_ISSUE_FAILED");
      setFixtureConfirmation(parsed.data);
    } catch {
      setFixtureConfirmationError("確認卡目前無法建立；案件內容沒有變更。");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">租得明白 RentProof</div>
        {runtimeStatus.authMode === "self_hosted" ? (
          <a href="/auth" className="auth-link">
            登入／註冊
          </a>
        ) : null}
      </header>
      {runtimeStatus.llmMode === "live" && runtimeStatus.projectLimits === "unverified" ? (
        <div className="project-limit-warning" role="alert">
          OpenAI Project 額度尚未經操作人員確認。Live
          可能產生費用；請先核對每月上限、警示與模型速率限制。
        </div>
      ) : null}

      <div className="page-grid">
        <section className="conversation-column" aria-labelledby="case-title">
          <div className="case-header">
            <p className="eyebrow">簽約前證據整理</p>
            <h1 id="case-title">晴光套房 302</h1>
            <p className="subtitle">
              我會逐步核對廣告、看屋證據與契約。沒有拍到不等於矛盾；每個結果都必須能回到來源。
            </p>
          </div>

          <GoldenUploadPanel />

          <div className="timeline" aria-label="案件對話">
            <article className="message assistant">
              <div className="message-label">RentProof・系統引導</div>
              <p>我們先確認廣告承諾。目前資料顯示月租、洗衣機、電費與租金補貼四項資訊。</p>
            </article>

            <article className="evidence-card" aria-labelledby="candidate-title">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">待確認候選</p>
                  <h2 id="candidate-title">電費由房客負擔</h2>
                </div>
                <span className="status-pill">
                  {fixtureAppliedRevision === null
                    ? "尚未寫入案件"
                    : `已寫入修訂 ${fixtureAppliedRevision}`}
                </span>
              </div>
              <p>這是從虛構廣告與契約抽出的候選資料。確認後才會成為案件事實。</p>
              {fixtureConfirmation ? (
                <PendingConfirmationCard
                  value={fixtureConfirmation}
                  onApplied={setFixtureAppliedRevision}
                />
              ) : (
                <div className="card-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={issueFixtureConfirmation}
                  >
                    產生確認卡
                  </button>
                </div>
              )}
              {fixtureConfirmationError ? (
                <p className="composer-error" role="alert">
                  {fixtureConfirmationError}
                </p>
              ) : null}
            </article>

            <article className="evidence-card" aria-labelledby="finding-title">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">證據不足</p>
                  <h2 id="finding-title">尚未取得洗衣機證據</h2>
                </div>
                <FileSearch aria-hidden="true" size={22} />
              </div>
              <p>看屋影像未涵蓋洗衣機位置，契約附件也未列出；這不代表現場沒有洗衣機。</p>
              <div className="card-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setDraft("為什麼洗衣機承諾目前是證據不足？")}
                >
                  針對這項提問
                </button>
                <a
                  className="secondary-button"
                  href="/api/demo/golden-v1/artifacts/viewing-view-10-jpg"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看來源
                </a>
              </div>
            </article>

            {submittedTurns.map((turn) => (
              <div key={turn.id} className="timeline">
                <article className="message user">
                  <div className="message-label">你</div>
                  <p>{turn.userText}</p>
                </article>
                <article className="message assistant">
                  <div className="message-label">
                    RentProof・{runtimeStatus.llmMode === "live" ? "OpenAI Live" : "Fixture"} 回覆
                  </div>
                  {turn.assistant.segments.map((segment, index) => (
                    <p key={`${turn.id}-segment-${index}`}>{segment.text}</p>
                  ))}
                  {turn.assistant.cards.map((card) => (
                    <div className="inline-result" key={card.cardId}>
                      {card.cardType === "candidate_confirmation" ? (
                        <PendingConfirmationCard value={{ ok: true, ...card, caseRevision: 1 }} />
                      ) : (
                        <>
                          <strong>{card.title}</strong>
                          <span>{card.description}</span>
                        </>
                      )}
                    </div>
                  ))}
                  {turn.assistant.remainingItemCount > 0 ? (
                    <button className="secondary-button" type="button">
                      另有 {turn.assistant.remainingItemCount} 項，查看證據工作區
                    </button>
                  ) : null}
                </article>
              </div>
            ))}
          </div>

          <form className="composer" onSubmit={submitTurn}>
            <label htmlFor="conversation-input" className="message-label">
              輸入你的問題
            </label>
            <textarea
              id="conversation-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="例如：為什麼這項是證據不足？"
              aria-describedby="composer-help composer-count"
            />
            <div id="composer-help" className="warning-note">
              <ShieldAlert aria-hidden="true" size={18} /> HTTP
              傳輸可能被讀取或修改；請只使用虛構資料。
            </div>
            {error ? (
              <p className="composer-error" role="alert">
                {error}
              </p>
            ) : null}
            {piiWarning ? (
              <div className="pii-warning" role="alert">
                <strong>可能包含個人資料</strong>
                <p>
                  偵測類型：{piiWarning.piiKinds.join("、")}。HTTP
                  首次傳送已可能暴露內容；你可以返回修改，或明確繼續。
                </p>
                <div className="card-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setPiiWarning(null)}
                  >
                    返回修改
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={confirmPiiWarning}
                    disabled={isSubmitting}
                  >
                    我了解，仍要送出
                  </button>
                </div>
              </div>
            ) : null}
            <div className="composer-footer">
              <span id="composer-count" className="counter" aria-live="polite">
                {count.toLocaleString("zh-TW")} / {maxCodePoints.toLocaleString("zh-TW")}
              </span>
              <button
                className="primary-button"
                type="submit"
                disabled={overLimit || count === 0 || isSubmitting}
              >
                {isSubmitting ? "處理中" : "送出"} <ArrowUp aria-hidden="true" size={18} />
              </button>
            </div>
          </form>
        </section>

        <aside className="workspace-panel" aria-labelledby="workspace-title">
          <p className="eyebrow">Evidence Workspace</p>
          <h2 id="workspace-title">案件證據工作區</h2>
          <p className="subtitle">對話與四區工作區使用相同 Snapshot，不在瀏覽器重新判斷結果。</p>
          <Tabs.Root className="workspace-tabs" defaultValue="summary">
            <Tabs.List className="workspace-tab-list" aria-label="案件證據區域">
              <Tabs.Trigger className="workspace-tab" value="summary">
                摘要
              </Tabs.Trigger>
              <Tabs.Trigger className="workspace-tab" value="evidence">
                證據
              </Tabs.Trigger>
              <Tabs.Trigger className="workspace-tab" value="contract">
                契約
              </Tabs.Trigger>
              <Tabs.Trigger className="workspace-tab" value="report">
                報告
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content className="workspace-tab-content" value="summary">
              <h3>物件摘要</h3>
              <dl className="summary-grid">
                <div>
                  <dt>固定月費</dt>
                  <dd>租金 NT$12,000・管理費 NT$1,000</dd>
                </div>
                <div>
                  <dt>依使用量</dt>
                  <dd>廣告載每度 NT$5，尚缺帳單佐證</dd>
                </div>
                <div>
                  <dt>一次性費用</dt>
                  <dd>押金 NT$24,000</dd>
                </div>
              </dl>
            </Tabs.Content>
            <Tabs.Content className="workspace-tab-content" value="evidence">
              <h3>證據矩陣</h3>
              <ul className="workspace-list">
                <li className="workspace-item">
                  <strong>月租 NT$12,000</strong>
                  <span>支持</span>
                </li>
                <li className="workspace-item">
                  <strong>附洗衣機</strong>
                  <span>證據不足</span>
                </li>
                <li className="workspace-item">
                  <strong>電費每度 NT$5</strong>
                  <span>契約有明確不同文字，待確認</span>
                </li>
              </ul>
            </Tabs.Content>
            <Tabs.Content className="workspace-tab-content" value="contract">
              <h3>契約檢查</h3>
              <ul className="workspace-list">
                <li className="workspace-item">
                  <strong>設備附件</strong>
                  <span>未列洗衣機，資料不足</span>
                </li>
                <li className="workspace-item">
                  <strong>電費條款</strong>
                  <span>與廣告說法疑似差異</span>
                </li>
                <li className="workspace-item">
                  <strong>租金補貼</strong>
                  <span>含限制文字，待人工確認</span>
                </li>
              </ul>
            </Tabs.Content>
            <Tabs.Content className="workspace-tab-content" value="report">
              <h3>簽約前報告</h3>
              <ol className="report-actions">
                <li>將洗衣機名稱、數量與交付狀態寫入附件。</li>
                <li>索取同一標的同一期電費單與計算方式。</li>
                <li>確認租金補貼限制文字是否修改。</li>
              </ol>
              <a className="primary-button report-link" href="/reports/golden-v1">
                開啟完整可列印報告
              </a>
              <p className="risk-note">
                付款前查證：虛構互動中出現首次實地看屋前付款要求；這是風險訊號，不是詐騙判決。
              </p>
            </Tabs.Content>
          </Tabs.Root>
          <div className="card-actions" aria-label="Golden case 原始素材">
            <a
              className="secondary-button"
              href="/api/demo/golden-v1/artifacts/listing-synthetic-listing-png"
              target="_blank"
              rel="noreferrer"
            >
              查看虛構廣告
            </a>
            <a
              className="secondary-button"
              href="/api/demo/golden-v1/artifacts/viewing-view-10-jpg"
              target="_blank"
              rel="noreferrer"
            >
              查看陽台證據
            </a>
            <a
              className="secondary-button"
              href="/api/demo/golden-v1/artifacts/contract-synthetic-lease-pdf"
              target="_blank"
              rel="noreferrer"
            >
              查看虛構租約
            </a>
          </div>
          <div className="warning-note">
            這是預先分析的 Synthetic Fixture，不是法律意見或詐騙判決。
          </div>
        </aside>
      </div>
      <footer className="site-footer">
        <nav aria-label="政策草案">
          <a href="/privacy">隱私政策</a>
          <a href="/terms">使用條款</a>
          <a href="/cookies">Cookie 政策</a>
        </nav>
      </footer>
    </main>
  );
}
