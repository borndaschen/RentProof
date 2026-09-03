"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CaseHistorySummarySchema, type CaseHistorySummary } from "@/application/history";
import { HistoryList } from "./history-list";

const ResponseSchema = z
  .object({
    schemaVersion: z.literal("rentproof.case-history.v1"),
    cases: z.array(CaseHistorySummarySchema),
  })
  .strict();

type State =
  | { status: "loading" }
  | { status: "loaded"; cases: readonly CaseHistorySummary[] }
  | { status: "authentication_required" | "unavailable" };

export function HistoryClientPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void fetch("/api/history", { cache: "no-store", credentials: "same-origin" })
      .then(async (response): Promise<State> => {
        if (response.status === 401) return { status: "authentication_required" };
        if (!response.ok) return { status: "unavailable" };
        const parsed = ResponseSchema.safeParse((await response.json()) as unknown);
        return parsed.success
          ? { status: "loaded", cases: parsed.data.cases }
          : { status: "unavailable" };
      })
      .catch((): State => ({ status: "unavailable" }))
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loaded") return <HistoryList cases={state.cases} />;
  if (state.status === "loading")
    return <HistoryNotice title="正在載入" message="正在進行帳戶與案件擁有者驗證。" />;
  if (state.status === "authentication_required") {
    return <HistoryNotice title="請先登入" message="登入後才能查詢目前帳戶已保存的歷史案件。" />;
  }
  return (
    <HistoryNotice
      title="歷史案件目前無法使用"
      message="請檢查本機 Demo 的帳戶與 PostgreSQL 設定；系統不會改用記憶體資料假裝成功。"
    />
  );
}

function HistoryNotice({ title, message }: { title: string; message: string }) {
  return (
    <main className="history-shell">
      <section className="history-empty">
        <p className="eyebrow">ACCOUNT HISTORY</p>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="card-actions">
          <Link className="primary-button" href="/auth">
            前往登入／註冊
          </Link>
          <Link className="secondary-button" href="/">
            返回 Demo
          </Link>
        </div>
      </section>
    </main>
  );
}
