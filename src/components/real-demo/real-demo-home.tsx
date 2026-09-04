"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { REAL_DEMO_CLOUD_CONSENT_TEXT } from "@/application/real-demo/contracts";

type Session =
  | { status: "loading"; csrfToken: "" }
  | { status: "signed_out" | "guest" | "authenticated"; csrfToken: string }
  | { status: "unavailable"; csrfToken: "" };

type Receipt = Readonly<{
  artifactId: string;
  kind: "listing_image" | "viewing_image" | "contract_pdf" | "follow_up_image";
  mime: "image/jpeg" | "image/png" | "application/pdf";
}>;

type AnalysisSummary = Readonly<{
  findings: readonly { status: "supported" | "contradicted" | "insufficient_evidence" }[];
  nextActions: readonly string[];
}>;

const kindLabels = {
  listing_image: "租屋廣告",
  viewing_image: "看屋照片",
  contract_pdf: "租約",
  follow_up_image: "補拍照片",
} as const;

export function RealDemoHome({ analysisEnabled = false }: { analysisEnabled?: boolean }) {
  const request = useAbortableFetch();
  const [session, setSession] = useState<Session>({ status: "loading", csrfToken: "" });
  const [caseId, setCaseId] = useState<string | null>(null);
  const [caseName, setCaseName] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [cloudAcknowledged, setCloudAcknowledged] = useState(false);
  const [piiAcknowledgement, setPiiAcknowledgement] = useState<string | null>(null);
  const [freeTextTurns, setFreeTextTurns] = useState<readonly string[]>([]);
  const [receipts, setReceipts] = useState<readonly Receipt[]>([]);
  const [listingUrlAdded, setListingUrlAdded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as unknown;
        if (!active || !response.ok || !isSessionResponse(data)) return null;
        return data;
      })
      .then(async (data) => {
        if (!active) return;
        if (data?.status === "signed_out") {
          const guest = await fetch("/api/guest/session", {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!active) return;
          setSession(
            guest.ok
              ? { status: "guest", csrfToken: data.csrfToken }
              : { status: "unavailable", csrfToken: "" },
          );
          return;
        }
        setSession(
          data
            ? { status: data.status, csrfToken: data.csrfToken }
            : { status: "unavailable", csrfToken: "" },
        );
      })
      .catch(() => {
        if (active) setSession({ status: "unavailable", csrfToken: "" });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  async function createCase(displayName: string) {
    if (!hasCaseSession(session) || !displayName.trim() || !cloudAcknowledged || busy) return;
    const initialUrl = singleHttpsUrl(displayName);
    const caseDisplayName = initialUrl ? new URL(initialUrl).hostname : displayName.trim();
    setBusy(true);
    setMessage("");
    try {
      const response = await request("/api/real-cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RentProof-CSRF": session.csrfToken,
        },
        body: JSON.stringify({
          displayName: caseDisplayName,
          cloudProcessingAcknowledged: cloudAcknowledged,
        }),
      });
      const data = (await response.json()) as unknown;
      if (!response.ok || !isCreatedCase(data)) throw new Error("CREATE_FAILED");
      setCaseId(data.caseId);
      setCaseName(caseDisplayName);
      setDraftMessage("");
      if (initialUrl) {
        setFreeTextTurns((current) => [...current, initialUrl]);
        const recognized = await recognizeText(initialUrl, data.caseId);
        setMessage(recognized?.reply ?? "案件已建立，但租屋連結尚未加入。");
      } else {
        setMessage("案件已建立，可以開始加入資料。");
      }
    } catch {
      setMessage("目前無法建立案件，請確認已勾選資料處理同意並稍後重試。");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!hasCaseSession(session) || !caseId || busy) return;
    const file = selectedFile;
    const accompanyingText = draftMessage.trim();
    if (!file || file.size === 0) return;
    const mime = acceptedMime(file.type);
    const step = nextUploadStep(receipts, listingUrlAdded);
    if (!mime || !step.accepts.includes(mime)) {
      setMessage(
        step.kind === "contract_pdf" ? "請選擇 PDF 租約檔案。" : "請選擇 JPEG 或 PNG 圖片。",
      );
      return;
    }
    const kind = step.kind;
    const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
    setBusy(true);
    setMessage("正在安全處理檔案…");
    try {
      const response = await request(`/api/real-cases/${encodeURIComponent(caseId)}/uploads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-RentProof-CSRF": session.csrfToken,
          "X-RentProof-Upload-Filename": `upload.${extension}`,
          "X-RentProof-Upload-Mime": mime,
          "X-RentProof-Upload-Kind": kind,
          "Idempotency-Key": crypto.randomUUID(),
          ...(piiAcknowledgement ? { "PII-Acknowledgement": piiAcknowledgement } : {}),
        },
        body: file,
      });
      const data = (await response.json()) as unknown;
      if (!response.ok || !isReceipt(data)) throw new Error("UPLOAD_FAILED");
      setReceipts((current) => [...current, data]);
      if (accompanyingText) {
        setFreeTextTurns((current) => [...current, accompanyingText]);
      }
      setSelectedFile(null);
      setDraftMessage("");
      setMessage(`${kindLabels[data.kind]}已安全加入。`);
    } catch {
      setMessage("檔案未加入。請確認格式、大小與內容後重試。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCase() {
    if (!hasCaseSession(session) || !caseId || busy) return;
    setBusy(true);
    try {
      const response = await request(`/api/real-cases/${encodeURIComponent(caseId)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-RentProof-CSRF": session.csrfToken,
        },
        body: "{}",
      });
      if (!response.ok) throw new Error("DELETE_FAILED");
      setCaseId(null);
      setCaseName("");
      setReceipts([]);
      setAnalysis(null);
      setListingUrlAdded(false);
      setMessage("案件已刪除並停止存取。");
    } catch {
      setMessage("目前無法刪除案件，請稍後重試。");
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (!hasCaseSession(session) || !caseId || busy) return;
    setBusy(true);
    setMessage("正在整理資料…");
    try {
      const response = await request(`/api/real-cases/${encodeURIComponent(caseId)}/analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RentProof-CSRF": session.csrfToken,
        },
        body: "{}",
      });
      const data = (await response.json()) as unknown;
      if (!response.ok || !isAnalysis(data)) throw new Error("ANALYSIS_FAILED");
      setAnalysis(data);
      setMessage("整理完成。請逐項查看仍需確認的內容。");
    } catch {
      setMessage("目前無法完成整理；已加入的資料不會被標示為分析成功。");
    } finally {
      setBusy(false);
    }
  }

  async function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draftMessage.trim();
    if (!hasCaseSession(session) || busy) return;
    if (!caseId) {
      if (text) await createCase(text);
      return;
    }
    if (selectedFile) {
      if (text && !(await recognizeText(text))) return;
      await upload();
      return;
    }
    if (text) {
      const recognized = await recognizeText(text);
      if (!recognized) return;
      setFreeTextTurns((current) => [...current, text]);
      setDraftMessage("");
      setMessage(recognized.reply);
      if (
        recognized.intent === "start_analysis" &&
        hasRequiredArtifacts(receipts, listingUrlAdded)
      ) {
        await analyze();
      }
    }
  }

  async function recognizeText(
    text: string,
    targetCaseId = caseId,
  ): Promise<{
    intent:
      | "start_analysis"
      | "listing_url_candidate"
      | "confirm_listing_url"
      | "listing_url_added"
      | "note"
      | "clarification_needed";
    reply: string;
  } | null> {
    if (!targetCaseId || !hasCaseSession(session)) return null;
    try {
      const response = await request(
        `/api/real-cases/${encodeURIComponent(targetCaseId)}/conversation`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-RentProof-CSRF": session.csrfToken,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ text }),
        },
      );
      const data = (await response.json()) as unknown;
      if (!response.ok && isPiiWarning(data)) {
        setPiiAcknowledgement(data.acknowledgementId);
        setMessage(
          "這段文字可能包含個人資料。請確認內容確實必要，再按一次「傳送」；這不代表系統能完整偵測所有個資。",
        );
        return null;
      }
      if (!response.ok || !isConversationRecognition(data)) throw new Error("TEXT_REJECTED");
      setPiiAcknowledgement(null);
      if (data.intent.kind === "listing_url_added") setListingUrlAdded(true);
      return { intent: data.intent.kind, reply: data.reply };
    } catch {
      setMessage("這段文字未通過安全或格式檢查，附件也尚未送出。請移除敏感資訊後重試。");
      return null;
    }
  }

  async function saveGuestCaseToAccount() {
    if (session.status !== "guest" || !caseId || busy) return;
    setBusy(true);
    setMessage("正在確認帳戶並保存案件…");
    try {
      const sessionResponse = await request("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const sessionData = (await sessionResponse.json()) as unknown;
      if (
        !sessionResponse.ok ||
        !isSessionResponse(sessionData) ||
        sessionData.status !== "authenticated"
      ) {
        throw new Error("ACCOUNT_REQUIRED");
      }
      const response = await request(`/api/real-cases/${encodeURIComponent(caseId)}/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RentProof-CSRF": sessionData.csrfToken,
        },
        body: JSON.stringify({ confirmation: "SAVE_GUEST_CASE_TO_ACCOUNT" }),
      });
      if (!response.ok) throw new Error("TRANSFER_FAILED");
      setSession({ status: "authenticated", csrfToken: sessionData.csrfToken });
      setMessage(
        "案件已保存到你的帳戶，之後可從「我的案件」查看。未來刪除前會依帳戶保存政策處理。",
      );
    } catch {
      setMessage("尚未完成保存。請先在新分頁登入，並於登入後 15 分鐘內再按一次保存。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="real-demo-shell">
      <header className="real-demo-header">
        <div>
          <p className="eyebrow">租得明白 RentProof</p>
          <h1>開始整理租屋資料</h1>
          <p className="subtitle">跟著對話加入資料，我們會一步一步整理需要確認的地方。</p>
        </div>
        <nav aria-label="帳戶功能">
          <Link href="/rent-subsidy">租屋補助預檢</Link>
          {session.status === "authenticated" ? <Link href="/history">我的案件</Link> : null}
          <Link className="header-login-button" href="/auth">
            {session.status === "guest" ? "登入" : "帳戶"}
          </Link>
        </nav>
      </header>

      <section className="real-conversation" aria-label="租屋資料對話" aria-live="polite">
        <div className="real-message assistant">
          <p className="message-label">RentProof</p>
          <p>你好。直接輸入物件名稱、貼上租屋連結，或加入廣告、看屋照片與租約。</p>
        </div>

        {session.status === "loading" ? (
          <div className="real-message assistant">
            <p role="status">正在準備資料整理功能…</p>
          </div>
        ) : null}
        {session.status === "unavailable" ? (
          <div className="real-message assistant">
            <p role="alert">目前無法開始，請稍後再試。</p>
          </div>
        ) : null}

        {session.status === "guest" ? (
          <div className="real-message assistant guest-save-reminder">
            <p>
              目前以訪客模式使用，資料只會在這次訪客使用期間保留。若要日後查詢，請
              <Link href="/auth">登入後保存案件</Link>。
            </p>
          </div>
        ) : null}

        {hasCaseSession(session) && !caseId ? (
          <div className="real-message assistant">
            <p>先告訴我這間房子怎麼稱呼，也可以直接貼上公開的租屋網站連結。</p>
          </div>
        ) : null}

        {caseId ? (
          <div className="real-message user">
            <p className="message-label">你</p>
            <p>我要整理「{caseName}」。</p>
          </div>
        ) : null}

        {freeTextTurns.map((turn, index) => (
          <div className="real-message user" key={`${String(index)}:${turn}`}>
            <p className="message-label">你</p>
            <p>{turn}</p>
          </div>
        ))}

        {receipts.map((receipt) => (
          <div className="real-message user" key={receipt.artifactId}>
            <p className="message-label">你</p>
            <p>已加入：{kindLabels[receipt.kind]}</p>
          </div>
        ))}

        {message ? (
          <div className="real-message assistant real-status-message">
            <p role="status">{message}</p>
          </div>
        ) : null}

        {hasCaseSession(session) && caseId && !hasRequiredArtifacts(receipts, listingUrlAdded) ? (
          <div className="real-message assistant">
            <p>{nextConversationReply(receipts, listingUrlAdded)}</p>
          </div>
        ) : null}

        {hasCaseSession(session) &&
        caseId &&
        hasRequiredArtifacts(receipts, listingUrlAdded) &&
        !analysis ? (
          <div className="real-message assistant">
            <p>
              {analysisEnabled
                ? "資料已備妥。輸入「開始分析」，我會核對廣告、現場照片與租約。"
                : "資料已備妥，但分析功能目前尚未開啟。"}
            </p>
          </div>
        ) : null}

        {analysis ? <AnalysisMessage analysis={analysis} /> : null}

        {hasCaseSession(session) ? (
          <form className="real-composer" onSubmit={submitComposer}>
            {!caseId ? (
              <label className="real-composer-consent">
                <input
                  type="checkbox"
                  checked={cloudAcknowledged}
                  onChange={(event) => setCloudAcknowledged(event.currentTarget.checked)}
                />
                <span>
                  {REAL_DEMO_CLOUD_CONSENT_TEXT} <Link href="/privacy">查看資料處理說明</Link>
                </span>
              </label>
            ) : null}
            <div className="real-composer-row">
              {caseId ? (
                <label className="real-attachment-button">
                  <span>加入附件</span>
                  <input
                    key={nextUploadStep(receipts, listingUrlAdded).kind}
                    type="file"
                    accept={nextUploadStep(receipts, listingUrlAdded).accepts.join(",")}
                    onChange={(event) => {
                      setSelectedFile(event.currentTarget.files?.[0] ?? null);
                      setPiiAcknowledgement(null);
                    }}
                  />
                </label>
              ) : null}
              <label className="real-composer-input">
                <span className="sr-only">輸入訊息</span>
                <textarea
                  value={draftMessage}
                  onChange={(event) => {
                    setDraftMessage(event.currentTarget.value);
                    setPiiAcknowledgement(null);
                  }}
                  maxLength={2_000}
                  rows={2}
                  placeholder={
                    caseId
                      ? selectedFile
                        ? `已選擇 ${selectedFile.name}`
                        : "輸入訊息、貼上租屋連結，或加入附件…"
                      : "輸入物件名稱或貼上租屋連結…"
                  }
                />
              </label>
              <button
                className="primary-button real-send-button"
                type="submit"
                disabled={
                  busy ||
                  (!selectedFile && draftMessage.trim().length === 0) ||
                  (!caseId && !cloudAcknowledged)
                }
              >
                傳送
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {caseId ? (
        <aside className="real-case-summary" aria-labelledby="case-summary-title">
          <div>
            <p className="eyebrow">目前進度</p>
            <h2 id="case-summary-title">{caseName}</h2>
            <p>{receipts.length + (listingUrlAdded ? 1 : 0)} 份資料已加入</p>
          </div>
          <div className="real-case-actions">
            {session.status === "guest" ? (
              <>
                <Link className="secondary-button" href="/auth" target="_blank" rel="noreferrer">
                  在新分頁登入
                </Link>
                <button
                  className="primary-button"
                  type="button"
                  onClick={saveGuestCaseToAccount}
                  disabled={busy}
                >
                  已登入，保存此案件
                </button>
              </>
            ) : null}
            <button className="secondary-button" type="button" onClick={deleteCase} disabled={busy}>
              刪除這個案件
            </button>
          </div>
        </aside>
      ) : null}
    </main>
  );
}

type UploadStep = Readonly<{
  kind: Receipt["kind"];
  title: string;
  prompt: string;
  inputLabel: string;
  accepts: readonly Receipt["mime"][];
}>;

function AnalysisMessage({ analysis }: { analysis: AnalysisSummary }) {
  return (
    <article className="real-message assistant" aria-labelledby="analysis-summary-title">
      <p className="message-label">整理完成</p>
      <h2 id="analysis-summary-title">這些是目前的比對結果</h2>
      <dl className="summary-grid real-result-grid">
        <div>
          <dt>已有資料支持</dt>
          <dd>{countStatus(analysis, "supported")} 項</dd>
        </div>
        <div>
          <dt>內容不一致</dt>
          <dd>{countStatus(analysis, "contradicted")} 項</dd>
        </div>
        <div>
          <dt>仍需補充資料</dt>
          <dd>{countStatus(analysis, "insufficient_evidence")} 項</dd>
        </div>
      </dl>
      <section className="real-action-card" aria-labelledby="next-actions-title">
        <h3 id="next-actions-title">簽約前建議</h3>
        <ol>
          {analysis.nextActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function acceptedMime(value: string): Receipt["mime"] | null {
  return value === "image/jpeg" || value === "image/png" || value === "application/pdf"
    ? value
    : null;
}

function hasCaseSession(
  session: Session,
): session is { status: "guest" | "authenticated"; csrfToken: string } {
  return session.status === "guest" || session.status === "authenticated";
}

function isSessionResponse(
  value: unknown,
): value is { status: "signed_out" | "authenticated"; csrfToken: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    ["signed_out", "authenticated"].includes(String(Reflect.get(value, "status"))) &&
    typeof Reflect.get(value, "csrfToken") === "string"
  );
}

function isCreatedCase(value: unknown): value is { caseId: string } {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "caseId") === "string"
  );
}

function isReceipt(value: unknown): value is Receipt {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "artifactId") === "string" &&
    RealKinds.includes(String(Reflect.get(value, "kind"))) &&
    acceptedMime(String(Reflect.get(value, "mime"))) !== null
  );
}

function isAnalysis(value: unknown): value is AnalysisSummary {
  if (typeof value !== "object" || value === null) return false;
  const findings: unknown = Reflect.get(value, "findings");
  const nextActions: unknown = Reflect.get(value, "nextActions");
  return (
    Array.isArray(findings) &&
    findings.length <= 100 &&
    findings.every(
      (finding) =>
        typeof finding === "object" &&
        finding !== null &&
        ["supported", "contradicted", "insufficient_evidence"].includes(
          String(Reflect.get(finding, "status")),
        ),
    ) &&
    Array.isArray(nextActions) &&
    nextActions.length >= 1 &&
    nextActions.length <= 10 &&
    nextActions.every((action) => typeof action === "string" && action.length <= 240)
  );
}

function isConversationRecognition(value: unknown): value is {
  intent: {
    kind:
      | "start_analysis"
      | "listing_url_candidate"
      | "confirm_listing_url"
      | "listing_url_added"
      | "note"
      | "clarification_needed";
  };
  reply: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const intent: unknown = Reflect.get(value, "intent");
  const reply: unknown = Reflect.get(value, "reply");
  return (
    typeof intent === "object" &&
    intent !== null &&
    [
      "start_analysis",
      "listing_url_candidate",
      "confirm_listing_url",
      "listing_url_added",
      "note",
      "clarification_needed",
    ].includes(String(Reflect.get(intent, "kind"))) &&
    typeof reply === "string" &&
    [...reply].length <= 600
  );
}

function isPiiWarning(value: unknown): value is { acknowledgementId: string } {
  if (typeof value !== "object" || value === null) return false;
  const error: unknown = Reflect.get(value, "error");
  const acknowledgementId: unknown = Reflect.get(value, "acknowledgementId");
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "PII_WARNING_REQUIRED" &&
    typeof acknowledgementId === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(acknowledgementId)
  );
}

function nextUploadStep(receipts: readonly Receipt[], listingUrlAdded = false): UploadStep {
  if (!listingUrlAdded && !receipts.some((item) => item.kind === "listing_image")) {
    return {
      kind: "listing_image",
      title: "請加入租屋廣告",
      prompt: "上傳包含租金、設備與費用說明的廣告截圖。",
      inputLabel: "選擇租屋廣告圖片",
      accepts: ["image/jpeg", "image/png"],
    };
  }
  if (!receipts.some((item) => item.kind === "viewing_image")) {
    return {
      kind: "viewing_image",
      title: "接著加入看屋照片",
      prompt: "選擇一張能看清楚屋況或設備的照片。完成後仍可再補充照片。",
      inputLabel: "選擇看屋照片",
      accepts: ["image/jpeg", "image/png"],
    };
  }
  if (!receipts.some((item) => item.kind === "contract_pdf")) {
    return {
      kind: "contract_pdf",
      title: "最後加入租約",
      prompt: "目前接受文字清楚、未加密的 PDF 租約檔案。",
      inputLabel: "選擇 PDF 租約",
      accepts: ["application/pdf"],
    };
  }
  return {
    kind: "follow_up_image",
    title: "還要補充照片嗎？",
    prompt: "你可以加入需要進一步比對的近照或補拍照片。",
    inputLabel: "選擇補充照片",
    accepts: ["image/jpeg", "image/png"],
  };
}

function nextConversationReply(receipts: readonly Receipt[], listingUrlAdded = false): string {
  return nextUploadStep(receipts, listingUrlAdded).prompt;
}

function hasRequiredArtifacts(receipts: readonly Receipt[], listingUrlAdded = false): boolean {
  return (
    receipts.filter((item) => item.kind === "listing_image").length + (listingUrlAdded ? 1 : 0) ===
      1 &&
    receipts.some((item) => item.kind === "viewing_image" || item.kind === "follow_up_image") &&
    receipts.filter((item) => item.kind === "contract_pdf").length === 1
  );
}

function singleHttpsUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate.startsWith("https://") || /\s/u.test(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function countStatus(
  analysis: AnalysisSummary,
  status: AnalysisSummary["findings"][number]["status"],
): number {
  return analysis.findings.filter((finding) => finding.status === status).length;
}

const RealKinds = ["listing_image", "viewing_image", "contract_pdf", "follow_up_image"];

function useAbortableFetch() {
  const activeControllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);

  useEffect(() => {
    const controllers = activeControllers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, []);

  return useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!mounted.current) throw new DOMException("Page unmounted", "AbortError");
    const controller = new AbortController();
    const controllers = activeControllers.current;
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 60_000);
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        controllers.delete(controller);
      },
      { once: true },
    );
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }, []);
}
