"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CaseHistoryDetail } from "@/application/history";
import { parseHistoryDetailResponse } from "./history-client-parser";
import { HistoryDetail } from "./history-detail";

type State =
  | { status: "loading" | "not_found" | "unavailable" }
  | { status: "loaded"; rentalCase: CaseHistoryDetail };

export function HistoryDetailClientPage({ caseId }: { caseId: string }) {
  return <ScopedHistoryDetail key={caseId} caseId={caseId} />;
}

function ScopedHistoryDetail({ caseId }: { caseId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch(`/api/history/${encodeURIComponent(caseId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response): Promise<State> => {
        if (response.status === 404 || response.status === 401) return { status: "not_found" };
        if (!response.ok) return { status: "unavailable" };
        const parsed = parseHistoryDetailResponse((await response.json()) as unknown);
        return parsed === null || parsed.caseId !== caseId
          ? { status: "unavailable" }
          : { status: "loaded", rentalCase: parsed };
      })
      .catch((): State => ({ status: "unavailable" }))
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [caseId]);

  if (state.status === "loaded") return <HistoryDetail rentalCase={state.rentalCase} />;
  return (
    <main className="history-shell">
      <section className="history-empty">
        <h1>
          {state.status === "loading"
            ? "正在驗證案件"
            : state.status === "not_found"
              ? "找不到案件"
              : "暫時無法載入"}
        </h1>
        <p>為保護隱私，找不到案件、尚未登入或沒有查看權限時，畫面都不會顯示案件內容。</p>
        <Link className="secondary-button" href="/history">
          返回
        </Link>
      </section>
    </main>
  );
}
