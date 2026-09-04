import Link from "next/link";
import type { CaseHistoryDetail as CaseHistoryDetailModel } from "@/application/history";
import { formatHistoryTimestamp, historyStatusLabel } from "./history-presentation";

export function HistoryDetail({ rentalCase }: { rentalCase: CaseHistoryDetailModel }) {
  return (
    <main className="history-shell">
      <Link className="legal-back" href="/history">
        返回
      </Link>
      <article className="history-detail">
        <p className="eyebrow">案件摘要</p>
        <h1>{rentalCase.displayName}</h1>
        <p>這個案件只有目前登入的帳戶可以查看。</p>
        <dl>
          <div>
            <dt>案件狀態</dt>
            <dd>{historyStatusLabel(rentalCase.status)}</dd>
          </div>
          <div>
            <dt>內容版本</dt>
            <dd>{rentalCase.revision}</dd>
          </div>
          <div>
            <dt>整理方式</dt>
            <dd>{rentalCase.sourceMode === "fixture" ? "預先整理結果" : "OpenAI 雲端分析"}</dd>
          </div>
          <div>
            <dt>建立時間</dt>
            <dd>{formatHistoryTimestamp(rentalCase.createdAt)}</dd>
          </div>
          <div>
            <dt>更新時間</dt>
            <dd>{formatHistoryTimestamp(rentalCase.updatedAt)}</dd>
          </div>
        </dl>
      </article>
    </main>
  );
}
