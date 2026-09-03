"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CaseHistoryDetailSchema, type CaseHistoryDetail } from "@/application/history";
import { HistoryDetail } from "./history-detail";

const ResponseSchema = z
  .object({
    schemaVersion: z.literal("rentproof.case-history-detail.v1"),
    case: CaseHistoryDetailSchema,
  })
  .strict();

type State =
  | { status: "loading" | "not_found" | "unavailable" }
  | { status: "loaded"; rentalCase: CaseHistoryDetail };

export function HistoryDetailClientPage({ caseId }: { caseId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void fetch(`/api/history/${encodeURIComponent(caseId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response): Promise<State> => {
        if (response.status === 404 || response.status === 401) return { status: "not_found" };
        if (!response.ok) return { status: "unavailable" };
        const parsed = ResponseSchema.safeParse((await response.json()) as unknown);
        return parsed.success
          ? { status: "loaded", rentalCase: parsed.data.case }
          : { status: "unavailable" };
      })
      .catch((): State => ({ status: "unavailable" }))
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
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
        <p>不存在、未登入與非案件擁有者不會揭露不同的案件內容。</p>
        <Link className="secondary-button" href="/history">
          返回
        </Link>
      </section>
    </main>
  );
}
