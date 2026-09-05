"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { REAL_DEMO_CLOUD_CONSENT_TEXT } from "@/application/real-demo/contracts";
import { ProcessingCard, isProcessingReceipt, type ProcessingReceipt } from "./processing-card";

type Session =
  | { status: "loading"; csrfToken: "" }
  | { status: "signed_out" | "guest" | "authenticated"; csrfToken: string }
  | { status: "unavailable"; csrfToken: "" };

type Receipt = Readonly<{
  artifactId: string;
  kind: "listing_image" | "viewing_image" | "contract_pdf" | "follow_up_image" | "viewing_video";
  mime: "image/jpeg" | "image/png" | "application/pdf" | "video/mp4";
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
  viewing_video: "看屋影片",
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
  const [processing, setProcessing] = useState<ProcessingReceipt | null>(null);
  const [ocrConsentFile, setOcrConsentFile] = useState<File | null>(null);
  const uploadIdentity = useRef<{ file: File; caseId: string; key: string } | null>(null);
  const finishProcessing = useCallback((receipt: ProcessingReceipt | null) => {
    if (receipt)
      setReceipts((current) =>
        current.some((item) => item.artifactId === receipt.artifactId)
          ? current
          : [...current, receipt],
      );
    setProcessing(null);
  }, []);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [operationBusy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submissionLock = useRef(false);
  const busy = operationBusy || submitting;
  const [message, setMessage] = useState("");
  const [accountSession, setAccountSession] = useState<{ csrfToken: string } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

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

  useEffect(() => {
    if (session.status !== "guest" || caseId === null) {
      return;
    }
    let active = true;
    async function refreshAccountSession() {
      try {
        const response = await request("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const data: unknown = await response.json();
        if (!active || !response.ok || !isSessionResponse(data)) return;
        setSession((current) =>
          current.status === "guest" ? { ...current, csrfToken: data.csrfToken } : current,
        );
        setAccountSession(data.status === "authenticated" ? { csrfToken: data.csrfToken } : null);
      } catch {
        if (active) setAccountSession(null);
      }
    }
    const handleFocus = () => void refreshAccountSession();
    window.addEventListener("focus", handleFocus);
    void refreshAccountSession();
    return () => {
      active = false;
      window.removeEventListener("focus", handleFocus);
    };
  }, [caseId, request, session.status]);

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

  async function upload(allowOcr = false) {
    if (!hasCaseSession(session) || !caseId || busy || processing) return;
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
    const kind = mime === "video/mp4" ? "viewing_video" : step.kind;
    const extension =
      mime === "application/pdf"
        ? "pdf"
        : mime === "video/mp4"
          ? "mp4"
          : mime === "image/png"
            ? "png"
            : "jpg";
    setBusy(true);
    setMessage("正在安全處理檔案…");
    if (uploadIdentity.current?.file !== file || uploadIdentity.current.caseId !== caseId) {
      uploadIdentity.current = { file, caseId, key: crypto.randomUUID() };
    }
    const uploadKey = uploadIdentity.current.key;
    try {
      const response = await request(
        `/api/real-cases/${encodeURIComponent(caseId)}/uploads`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-RentProof-CSRF": session.csrfToken,
            "X-RentProof-Upload-Filename": `upload.${extension}`,
            "X-RentProof-Upload-Mime": mime,
            "X-RentProof-Upload-Kind": kind,
            "Idempotency-Key": uploadKey,
            ...(allowOcr && ocrConsentFile === file
              ? { "X-RentProof-OCR-Consent": "confirmed" }
              : {}),
          },
          body: file,
        },
        mime === "video/mp4" ? 240_000 : 60_000,
      );
      const data = (await response.json()) as unknown;
      if (
        response.status === 409 &&
        typeof data === "object" &&
        data !== null &&
        typeof Reflect.get(data, "error") === "object" &&
        Reflect.get(data, "error") !== null &&
        Reflect.get(Reflect.get(data, "error") as object, "code") ===
          "OCR_CLOUD_CONFIRMATION_REQUIRED"
      ) {
        setOcrConsentFile(file);
        setMessage("這份 PDF 需要辨識文字。請先確認是否同意雲端辨識。");
        return;
      }
      if (response.status === 202 && isProcessingReceipt(data)) {
        uploadIdentity.current = null;
        setProcessing(data);
        setOcrConsentFile(null);
        setSelectedFile(null);
        setDraftMessage("");
        setMessage("檔案已排入處理。完成前不會加入分析。");
        return;
      }
      if (!response.ok || !isReceipt(data)) throw new Error("UPLOAD_FAILED");
      uploadIdentity.current = null;
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

  function clearCaseProjection() {
    uploadIdentity.current = null;
    setCaseId(null);
    setCaseName("");
    setReceipts([]);
    setAnalysis(null);
    setListingUrlAdded(false);
    setAccountSession(null);
    setSelectedFile(null);
    setProcessing(null);
    setOcrConsentFile(null);
    setDraftMessage("");
    setFreeTextTurns([]);
    setPiiAcknowledgement(null);
    setCloudAcknowledged(false);
    setIsDraggingFile(false);
    setMessage("");
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
      clearCaseProjection();
      setMessage("案件已刪除並停止存取。");
    } catch {
      setMessage("目前無法刪除案件，請稍後重試。");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (session.status !== "authenticated" || busy) return;
    setBusy(true);
    let revoked = false;
    try {
      const response = await request("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RentProof-CSRF": session.csrfToken,
        },
        body: "{}",
      });
      if (!response.ok) throw new Error("LOGOUT_FAILED");
      revoked = true;
      clearCaseProjection();
      setSession({ status: "loading", csrfToken: "" });
      const guest = await request("/api/guest/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!guest.ok) throw new Error("GUEST_SESSION_FAILED");
      setSession({ status: "guest", csrfToken: session.csrfToken });
    } catch {
      if (revoked) setSession({ status: "unavailable", csrfToken: "" });
      setMessage(
        revoked
          ? "已登出。訪客功能暫時無法使用，請重新整理頁面後再試。"
          : "目前無法安全登出，請稍後再試。",
      );
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
    if (busy || submissionLock.current) return;
    submissionLock.current = true;
    setSubmitting(true);
    try {
      await submitDraft();
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }

  async function submitDraft() {
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
            ...(piiAcknowledgement ? { "PII-Acknowledgement": piiAcknowledgement } : {}),
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
    if (session.status !== "guest" || !accountSession || !caseId || busy) return;
    setBusy(true);
    setMessage("正在確認帳戶並保存案件…");
    try {
      const response = await request(`/api/real-cases/${encodeURIComponent(caseId)}/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RentProof-CSRF": accountSession.csrfToken,
        },
        body: JSON.stringify({ confirmation: "SAVE_GUEST_CASE_TO_ACCOUNT" }),
      });
      if (!response.ok) throw new Error("TRANSFER_FAILED");
      setSession({ status: "authenticated", csrfToken: accountSession.csrfToken });
      setAccountSession(null);
      setMessage(
        "案件已保存到你的帳戶，之後可從「我的案件」查看。未來刪除前會依帳戶保存政策處理。",
      );
    } catch {
      setAccountSession(null);
      setMessage("尚未完成保存。你仍可刪除案件；若要再試，請重新確認登入狀態。");
    } finally {
      setBusy(false);
    }
  }

  function handleFileDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    if (!caseId || busy) return;
    const file = event.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      setPiiAcknowledgement(null);
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
          <Link className="header-nav-button" href="/rent-subsidy">
            租屋補助預檢
          </Link>
          {session.status === "authenticated" ? (
            <>
              <Link className="header-nav-button" href="/history">
                我的案件
              </Link>
              <button className="header-nav-button" type="button" onClick={logout} disabled={busy}>
                登出
              </button>
            </>
          ) : (
            <Link className="header-nav-button" href="/auth">
              登入
            </Link>
          )}
        </nav>
      </header>

      <section className="real-conversation" aria-label="租屋資料對話">
        <div className="real-message assistant">
          <p className="message-label">RentProof</p>
          <p>
            你好。先告訴我這間房子怎麼稱呼，也可以直接貼上公開的租屋網站連結；建立案件後再加入廣告、看屋照片或影片與租約。
          </p>
          {session.status === "guest" ? (
            <p className="guest-save-reminder">
              目前以訪客模式使用，資料只會在這次訪客使用期間保留。若要日後查詢，請
              <Link href="/auth" target="_blank" rel="noreferrer">
                在新分頁登入後保存
              </Link>
              。
            </p>
          ) : null}
        </div>

        {session.status === "loading" ? (
          <div className="real-message assistant">
            <p className="message-label">RentProof</p>
            <p role="status">正在準備資料整理功能…</p>
          </div>
        ) : null}
        {session.status === "unavailable" ? (
          <div className="real-message assistant">
            <p className="message-label">RentProof</p>
            <p role="alert">目前無法開始，請稍後再試。</p>
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

        {caseId && processing ? (
          <ProcessingCard
            key={`${caseId}:${processing.artifactId}`}
            caseId={caseId}
            receipt={processing}
            csrfToken={session.csrfToken}
            onFinished={finishProcessing}
          />
        ) : null}
        {ocrConsentFile && ocrConsentFile === selectedFile ? (
          <div className="real-message assistant">
            <p className="message-label">RentProof</p>
            <p>
              掃描租約需要把這份 PDF 傳送至 OpenAI
              辨識。請先確認檔案沒有密碼、驗證碼、完整金融帳號或其他不必要個資；辨識完成後仍需你逐頁核對。
            </p>
            <button
              type="button"
              disabled={busy || !analysisEnabled}
              className="primary-button"
              onClick={() => {
                void upload(true);
              }}
            >
              同意雲端辨識這份租約
            </button>
            {!analysisEnabled ? <p>雲端分析尚未開啟，請改提供清楚的文字型 PDF。</p> : null}
          </div>
        ) : null}

        {message ? (
          <div className="real-message assistant real-status-message">
            <p className="message-label">RentProof</p>
            <p role="status">{message}</p>
          </div>
        ) : null}

        {hasCaseSession(session) &&
        caseId &&
        !processing &&
        !hasRequiredArtifacts(receipts, listingUrlAdded) ? (
          <div className="real-message assistant">
            <p className="message-label">RentProof</p>
            <p>{nextConversationReply(receipts, listingUrlAdded)}</p>
          </div>
        ) : null}

        {hasCaseSession(session) &&
        caseId &&
        hasRequiredArtifacts(receipts, listingUrlAdded) &&
        !analysis ? (
          <div className="real-message assistant">
            <p className="message-label">RentProof</p>
            <p>
              {analysisEnabled
                ? "資料已備妥。輸入「開始分析」，我會核對廣告、現場照片與租約。"
                : "資料已備妥，但分析功能目前尚未開啟。"}
            </p>
          </div>
        ) : null}

        {analysis ? <AnalysisMessage analysis={analysis} /> : null}

        {hasCaseSession(session) ? (
          <form
            className="real-composer"
            aria-busy={busy}
            data-dragging={isDraggingFile || undefined}
            onSubmit={submitComposer}
            onDragOver={(event) => {
              if (!caseId) return;
              event.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={handleFileDrop}
          >
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
                  <span className="real-attachment-label">拖曳或選擇附件</span>
                  <span className="real-attachment-plus" aria-hidden="true">
                    ＋
                  </span>
                  <span className="sr-only">加入附件</span>
                  <input
                    key={nextUploadStep(receipts, listingUrlAdded).kind}
                    type="file"
                    disabled={busy}
                    aria-label="加入附件"
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
                  disabled={busy}
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
            {session.status === "guest" && accountSession === null ? (
              <Link className="secondary-button" href="/auth" target="_blank" rel="noreferrer">
                在新分頁登入
              </Link>
            ) : null}
            {session.status === "guest" && accountSession !== null ? (
              <button
                className="primary-button"
                type="button"
                onClick={saveGuestCaseToAccount}
                disabled={busy}
              >
                保存
              </button>
            ) : null}
            <button className="secondary-button" type="button" onClick={deleteCase} disabled={busy}>
              刪除
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
      <p className="message-label">RentProof｜整理完成</p>
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
  return value === "image/jpeg" ||
    value === "image/png" ||
    value === "application/pdf" ||
    value === "video/mp4"
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
  if (!receipts.some((item) => item.kind === "viewing_image" || item.kind === "viewing_video")) {
    return {
      kind: "viewing_image",
      title: "接著加入看屋照片",
      prompt: "選擇能看清楚屋況或設備的照片，也可以加入30秒內的MP4看屋影片。",
      inputLabel: "選擇看屋照片或影片",
      accepts: ["image/jpeg", "image/png", "video/mp4"],
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
    receipts.some(
      (item) =>
        item.kind === "viewing_image" ||
        item.kind === "follow_up_image" ||
        item.kind === "viewing_video",
    ) &&
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

const RealKinds = [
  "listing_image",
  "viewing_image",
  "contract_pdf",
  "follow_up_image",
  "viewing_video",
];

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

  return useCallback(
    async (input: RequestInfo | URL, init?: RequestInit, timeoutMs = 60_000): Promise<Response> => {
      if (!mounted.current) throw new DOMException("Page unmounted", "AbortError");
      const controller = new AbortController();
      const controllers = activeControllers.current;
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    },
    [],
  );
}
