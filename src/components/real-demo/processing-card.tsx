"use client";

import { useEffect, useRef, useState } from "react";

export type ProcessingReceipt = Readonly<{
  artifactId: string;
  kind: "contract_pdf" | "viewing_video";
  mime: "application/pdf" | "video/mp4";
}>;
type Status = ProcessingReceipt & {
  state: "queued" | "running" | "requires_confirmation" | "available" | "failed" | "cancelled";
  reasonCode: string | null;
  confirmationId?: string;
  pages?: readonly { page: number; text: string }[];
};

export function ProcessingCard({
  caseId,
  receipt,
  csrfToken,
  onFinished,
}: {
  caseId: string;
  receipt: ProcessingReceipt;
  csrfToken: string;
  onFinished: (receipt: ProcessingReceipt | null) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const mutations = useRef(new AbortController());
  useEffect(() => {
    mutations.current = new AbortController();
    return () => mutations.current.abort();
  }, []);
  const url = `/api/real-cases/${encodeURIComponent(caseId)}/processing/${encodeURIComponent(receipt.artifactId)}`;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await fetch(url, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (
          !response.ok ||
          !isStatus(data) ||
          data.artifactId !== receipt.artifactId ||
          data.kind !== receipt.kind ||
          data.mime !== receipt.mime
        ) {
          setStatus(null);
          setError("目前無法確認處理狀態，請重新查詢。");
          return;
        }
        setStatus(data);
        setError("");
        if (data.state === "available") {
          onFinished(receipt);
          return;
        }
        if (data.state === "queued" || data.state === "running")
          timer = setTimeout(() => {
            void poll();
          }, 2_000);
      } catch {
        if (!controller.signal.aborted) {
          setStatus(null);
          setError("目前無法確認處理狀態，請重新查詢。");
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [url, receipt, onFinished, refresh]);

  async function mutate(action: "confirm" | "cancel") {
    if (busy || (action === "confirm" && (!checked || !status?.confirmationId))) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        signal: mutations.current.signal,
        method: action === "confirm" ? "POST" : "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-RentProof-CSRF": csrfToken },
        body:
          action === "confirm"
            ? JSON.stringify({ confirmationId: status?.confirmationId, explicitlyConfirmed: true })
            : "{}",
      });
      if (mutations.current.signal.aborted) return;
      if (!response.ok) {
        setChecked(false);
        setError("操作未完成。確認可能已過期或案件已變更，請重新查詢。");
        setRefresh((value) => value + 1);
        return;
      }
      if (action === "cancel") onFinished(null);
      else setRefresh((value) => value + 1);
    } catch {
      if (!mutations.current.signal.aborted) setError("連線中斷，請重新查詢狀態後再操作。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="real-message assistant" aria-label="檔案處理進度" aria-busy={busy}>
      <p className="message-label">RentProof</p>
      <p role="status">
        {status?.state === "requires_confirmation"
          ? "文字已辨識，請逐頁對照原始租約。尚未加入契約分析。"
          : status?.state === "failed" || status?.state === "cancelled"
            ? "這份資料尚未加入。請取消後重新提供檔案。"
            : "檔案正在背景處理，完成後才會加入案件。"}
      </p>
      {status?.state === "requires_confirmation" && status.pages ? (
        <>
          {status.pages.map((page) => (
            <details key={page.page}>
              <summary style={{ minHeight: 44, paddingBlock: 8, cursor: "pointer" }}>
                第 {page.page} 頁辨識文字
              </summary>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{page.text}</p>
            </details>
          ))}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 44,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(event) => setChecked(event.currentTarget.checked)}
            />
            我已逐頁對照原始租約，確認上述文字正確
          </label>
          <p>確認有效期限為 10 分鐘；文字有誤時，請取消並提供更清楚的檔案。</p>
          <button
            className="primary-button"
            type="button"
            disabled={!checked || busy}
            onClick={() => {
              void mutate("confirm");
            }}
          >
            確認文字並加入租約
          </button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button
        className="secondary-button"
        type="button"
        disabled={busy}
        onClick={() => {
          setChecked(false);
          setRefresh((value) => value + 1);
        }}
      >
        重新查詢進度
      </button>
      <button
        className="secondary-button"
        type="button"
        disabled={busy}
        onClick={() => {
          void mutate("cancel");
        }}
      >
        取消這份檔案
      </button>
    </section>
  );
}

export function isProcessingReceipt(value: unknown): value is ProcessingReceipt {
  if (typeof value !== "object" || value === null) return false;
  const id: unknown = Reflect.get(value, "artifactId");
  return (
    typeof id === "string" &&
    /^[A-Za-z0-9_-]{20,128}$/u.test(id) &&
    ((Reflect.get(value, "kind") === "contract_pdf" &&
      Reflect.get(value, "mime") === "application/pdf") ||
      (Reflect.get(value, "kind") === "viewing_video" &&
        Reflect.get(value, "mime") === "video/mp4"))
  );
}

function isStatus(value: unknown): value is Status {
  if (!isProcessingReceipt(value)) return false;
  const state: unknown = Reflect.get(value, "state");
  if (
    typeof state !== "string" ||
    !["queued", "running", "requires_confirmation", "available", "failed", "cancelled"].includes(
      state,
    )
  )
    return false;
  if (state !== "requires_confirmation") return true;
  const id: unknown = Reflect.get(value, "confirmationId");
  const pages: unknown = Reflect.get(value, "pages");
  return (
    typeof id === "string" &&
    /^[A-Za-z0-9_-]{20,128}$/u.test(id) &&
    Array.isArray(pages) &&
    pages.length > 0 &&
    pages.length <= 30 &&
    pages.every(
      (page: unknown, index) =>
        typeof page === "object" &&
        page !== null &&
        Reflect.get(page, "page") === index + 1 &&
        typeof Reflect.get(page, "text") === "string",
    )
  );
}
