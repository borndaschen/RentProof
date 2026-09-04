"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CaseHistorySummary } from "@/application/history";
import { parseHistoryResponse } from "./history-client-parser";
import { HistoryList } from "./history-list";

type State =
  | { status: "loading" }
  | { status: "loaded"; cases: readonly CaseHistorySummary[] }
  | { status: "authentication_required" | "unavailable" };

export function HistoryClientPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch("/api/history", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response): Promise<State> => {
        if (response.status === 401) return { status: "authentication_required" };
        if (!response.ok) return { status: "unavailable" };
        const parsed = parseHistoryResponse((await response.json()) as unknown);
        return parsed === null ? { status: "unavailable" } : { status: "loaded", cases: parsed };
      })
      .catch((): State => ({ status: "unavailable" }))
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  if (state.status === "loaded") return <HistoryList cases={state.cases} />;
  if (state.status === "loading")
    return <HistoryNotice title="正在載入" message="正在確認你可以查看的案件。" />;
  if (state.status === "authentication_required") {
    return <HistoryNotice title="請先登入" message="登入後才能查詢目前帳戶已保存的歷史案件。" />;
  }
  return (
    <HistoryNotice title="歷史案件目前無法使用" message="目前無法讀取案件資料，請稍後再試。" />
  );
}

function HistoryNotice({ title, message }: { title: string; message: string }) {
  return (
    <main className="history-shell">
      <section className="history-empty">
        <p className="eyebrow">我的案件</p>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="card-actions">
          <Link className="primary-button" href="/auth">
            前往登入／註冊
          </Link>
          <Link className="secondary-button" href="/">
            返回
          </Link>
        </div>
      </section>
    </main>
  );
}
