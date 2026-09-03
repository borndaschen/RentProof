"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
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
  const [session, setSession] = useState<Session>({ status: "loading", csrfToken: "" });
  const [caseId, setCaseId] = useState<string | null>(null);
  const [caseName, setCaseName] = useState("");
  const [receipts, setReceipts] = useState<readonly Receipt[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as unknown;
        if (!active || !response.ok || !isSessionResponse(data)) return null;
        return data;
      })
      .then(async (data) => {
        if (!active) return;
        if (data?.status === "signed_out") {
          const guest = await fetch("/api/guest/session", { cache: "no-store" });
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
    };
  }, []);

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasCaseSession(session) || !caseName.trim() || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/real-cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RentProof-CSRF": session.csrfToken,
        },
        body: JSON.stringify({
          displayName: caseName.trim(),
          cloudProcessingAcknowledged: form.get("cloudProcessingAcknowledged") === "on",
        }),
      });
      const data = (await response.json()) as unknown;
      if (!response.ok || !isCreatedCase(data)) throw new Error("CREATE_FAILED");
      setCaseId(data.caseId);
      setMessage("案件已建立，可以開始加入資料。");
    } catch {
      setMessage("目前無法建立案件，請確認已勾選資料處理同意並稍後重試。");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasCaseSession(session) || !caseId || busy) return;
    const form = event.currentTarget;
    const file = selectedFile;
    if (!file || file.size === 0) return;
    const mime = acceptedMime(file.type);
    const step = nextUploadStep(receipts);
    if (!mime || !step.accepts.includes(mime)) {
      setMessage(step.kind === "contract_pdf" ? "請選擇PDF格式的租約。" : "請選擇JPEG或PNG照片。");
      return;
    }
    const kind = step.kind;
    const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
    setBusy(true);
    setMessage("正在安全處理檔案…");
    try {
      const response = await fetch(`/api/real-cases/${encodeURIComponent(caseId)}/uploads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-RentProof-CSRF": session.csrfToken,
          "X-RentProof-Upload-Filename": `upload.${extension}`,
          "X-RentProof-Upload-Mime": mime,
          "X-RentProof-Upload-Kind": kind,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: file,
      });
      const data = (await response.json()) as unknown;
      if (!response.ok || !isReceipt(data)) throw new Error("UPLOAD_FAILED");
      setReceipts((current) => [...current, data]);
      setSelectedFile(null);
      form.reset();
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
      const response = await fetch(`/api/real-cases/${encodeURIComponent(caseId)}`, {
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
      const response = await fetch(`/api/real-cases/${encodeURIComponent(caseId)}/analysis`, {
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

  return (
    <main className="real-demo-shell">
      <header className="real-demo-header">
        <div>
          <p className="eyebrow">租得明白 RentProof</p>
          <h1>開始整理租屋資料</h1>
          <p className="subtitle">跟著對話加入資料，我們會一步一步整理需要確認的地方。</p>
        </div>
        <nav aria-label="帳戶功能">
          {session.status === "authenticated" ? <Link href="/history">我的案件</Link> : null}
          <Link href="/auth">{session.status === "guest" ? "登入保存紀錄" : "帳戶"}</Link>
        </nav>
      </header>

      <section className="real-conversation" aria-label="租屋資料對話" aria-live="polite">
        <article className="real-message assistant">
          <p className="message-label">RentProof</p>
          <p>你好，我會依序協助你加入物件名稱、租屋廣告、看屋照片與租約。</p>
        </article>

        {session.status === "loading" ? (
          <article className="real-message assistant">
            <p role="status">正在準備資料整理功能…</p>
          </article>
        ) : null}
        {session.status === "unavailable" ? (
          <article className="real-message assistant">
            <p role="alert">目前無法開始，請稍後再試。</p>
          </article>
        ) : null}

        {hasCaseSession(session) && !caseId ? (
          <article className="real-message assistant">
            <p className="message-label">第一步</p>
            <h2>這間房子要叫什麼名稱？</h2>
            <p>使用容易辨認的名稱，例如路名或社區名稱。</p>
            <form className="real-inline-card" onSubmit={createCase}>
              <label>
                案件名稱
                <input
                  value={caseName}
                  onChange={(event) => setCaseName(event.target.value)}
                  maxLength={120}
                  placeholder="例如：民生東路套房"
                  required
                />
              </label>
              <label className="auth-consent">
                <input name="cloudProcessingAcknowledged" type="checkbox" required />
                <span>
                  {REAL_DEMO_CLOUD_CONSENT_TEXT}
                  <Link href="/privacy">查看資料處理說明</Link>
                </span>
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                繼續
              </button>
            </form>
          </article>
        ) : null}

        {caseId ? (
          <article className="real-message user">
            <p className="message-label">你</p>
            <p>我要整理「{caseName}」。</p>
          </article>
        ) : null}

        {receipts.map((receipt) => (
          <article className="real-message user" key={receipt.artifactId}>
            <p className="message-label">你</p>
            <p>已加入：{kindLabels[receipt.kind]}</p>
          </article>
        ))}

        {hasCaseSession(session) && caseId && (!hasRequiredArtifacts(receipts) || analysis) ? (
          <UploadPrompt
            step={nextUploadStep(receipts)}
            busy={busy}
            selectedFile={selectedFile}
            onFileChange={setSelectedFile}
            onSubmit={upload}
          />
        ) : null}

        {hasCaseSession(session) && caseId && hasRequiredArtifacts(receipts) && !analysis ? (
          <article className="real-message assistant">
            <p className="message-label">資料已備妥</p>
            <h2>要開始整理與比對嗎？</h2>
            <p>我會核對廣告、現場照片與租約，並列出簽約前仍需確認的內容。</p>
            {analysisEnabled ? (
              <button className="primary-button" type="button" onClick={analyze} disabled={busy}>
                開始整理與比對
              </button>
            ) : (
              <p>分析功能目前尚未開啟。</p>
            )}
          </article>
        ) : null}

        {analysis ? <AnalysisMessage analysis={analysis} /> : null}
        {message ? (
          <article className="real-message assistant">
            <p role="status">{message}</p>
          </article>
        ) : null}
      </section>

      {caseId ? (
        <aside className="real-case-summary" aria-labelledby="case-summary-title">
          <div>
            <p className="eyebrow">目前進度</p>
            <h2 id="case-summary-title">{caseName}</h2>
            <p>{receipts.length} 份資料已加入</p>
          </div>
          <button className="secondary-button" type="button" onClick={deleteCase} disabled={busy}>
            刪除這個案件
          </button>
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

function UploadPrompt({
  step,
  busy,
  selectedFile,
  onFileChange,
  onSubmit,
}: {
  step: UploadStep;
  busy: boolean;
  selectedFile: File | null;
  onFileChange: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <article className="real-message assistant">
      <p className="message-label">下一步</p>
      <h2>{step.title}</h2>
      <p>{step.prompt}</p>
      <form className="real-inline-card" onSubmit={onSubmit}>
        <label>
          {step.inputLabel}
          <input
            key={step.kind}
            name="artifact"
            type="file"
            accept={step.accepts.join(",")}
            required
            onChange={(event) => onFileChange(event.currentTarget.files?.[0] ?? null)}
          />
        </label>
        <button className="primary-button" type="submit" disabled={busy || !selectedFile}>
          加入並繼續
        </button>
      </form>
    </article>
  );
}

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

function nextUploadStep(receipts: readonly Receipt[]): UploadStep {
  if (!receipts.some((item) => item.kind === "listing_image")) {
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
      prompt: "目前接受文字清楚、未加密的PDF檔案。",
      inputLabel: "選擇租約PDF",
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

function hasRequiredArtifacts(receipts: readonly Receipt[]): boolean {
  return (
    receipts.filter((item) => item.kind === "listing_image").length === 1 &&
    receipts.some((item) => item.kind === "viewing_image" || item.kind === "follow_up_image") &&
    receipts.filter((item) => item.kind === "contract_pdf").length === 1
  );
}

function countStatus(
  analysis: AnalysisSummary,
  status: AnalysisSummary["findings"][number]["status"],
): number {
  return analysis.findings.filter((finding) => finding.status === status).length;
}

const RealKinds = ["listing_image", "viewing_image", "contract_pdf", "follow_up_image"];
