"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { REAL_DEMO_CLOUD_CONSENT_TEXT } from "@/application/real-demo/contracts";

type Session =
  | { status: "loading"; csrfToken: "" }
  | { status: "signed_out" | "authenticated"; csrfToken: string }
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
  const [imageKind, setImageKind] = useState<"listing_image" | "viewing_image" | "follow_up_image">(
    "listing_image",
  );
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
      .then((data) => {
        if (!active) return;
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
    if (session.status !== "authenticated" || !caseName.trim() || busy) return;
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
    if (session.status !== "authenticated" || !caseId || busy) return;
    const form = event.currentTarget;
    const file = selectedFile;
    if (!file || file.size === 0) return;
    const mime = acceptedMime(file.type);
    if (!mime) {
      setMessage("目前只接受JPEG、PNG或文字型PDF。");
      return;
    }
    const kind = mime === "application/pdf" ? "contract_pdf" : imageKind;
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
    if (session.status !== "authenticated" || !caseId || busy) return;
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
    if (session.status !== "authenticated" || !caseId || busy) return;
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
          <h1>整理你的租屋資料</h1>
          <p className="subtitle">加入廣告、看屋照片與租約，我們會把需要確認的地方整理在一起。</p>
        </div>
        <nav aria-label="帳戶功能">
          <Link href="/history">我的案件</Link>
          <Link href="/auth">帳戶</Link>
        </nav>
      </header>

      {session.status === "loading" ? <p>正在確認登入狀態…</p> : null}
      {session.status === "signed_out" ? (
        <section className="real-demo-card">
          <h2>先登入或建立帳戶</h2>
          <p>登入後才能安全保存、查詢與刪除這次加入的資料。</p>
          <Link className="primary-button" href="/auth">
            登入／註冊
          </Link>
        </section>
      ) : null}
      {session.status === "unavailable" ? <p role="alert">帳戶服務目前無法使用。</p> : null}

      {session.status === "authenticated" && !caseId ? (
        <form className="real-demo-card" onSubmit={createCase}>
          <h2>建立案件</h2>
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
            建立案件
          </button>
        </form>
      ) : null}

      {session.status === "authenticated" && caseId ? (
        <section className="real-demo-card">
          <h2>{caseName}</h2>
          <form onSubmit={upload}>
            <label>
              照片類型
              <select
                value={imageKind}
                onChange={(event) =>
                  setImageKind(
                    event.target.value as "listing_image" | "viewing_image" | "follow_up_image",
                  )
                }
              >
                <option value="listing_image">租屋廣告</option>
                <option value="viewing_image">看屋照片</option>
                <option value="follow_up_image">補拍照片</option>
              </select>
            </label>
            <label>
              選擇檔案
              <input
                name="artifact"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                required
                onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              加入資料
            </button>
          </form>
          {receipts.length > 0 ? (
            <ul className="workspace-list" aria-label="已加入資料">
              {receipts.map((receipt) => (
                <li className="workspace-item" key={receipt.artifactId}>
                  <strong>{kindLabels[receipt.kind]}</strong>
                  <span>已安全保存</span>
                </li>
              ))}
            </ul>
          ) : null}
          {analysisEnabled && hasRequiredArtifacts(receipts) ? (
            <button className="primary-button" type="button" onClick={analyze} disabled={busy}>
              開始整理與比對
            </button>
          ) : null}
          {analysis ? (
            <section aria-labelledby="analysis-summary-title">
              <h3 id="analysis-summary-title">整理結果</h3>
              <dl className="summary-grid">
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
              <h3>簽約前建議</h3>
              <ol>
                {analysis.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            </section>
          ) : null}
          <button className="secondary-button" type="button" onClick={deleteCase} disabled={busy}>
            刪除這個案件
          </button>
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}

function acceptedMime(value: string): Receipt["mime"] | null {
  return value === "image/jpeg" || value === "image/png" || value === "application/pdf"
    ? value
    : null;
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
