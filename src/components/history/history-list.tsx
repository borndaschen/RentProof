import Link from "next/link";
import type { CaseHistorySummary } from "@/application/history";
import { formatHistoryTimestamp, historyStatusLabel } from "./history-presentation";

export function HistoryList({ cases }: { cases: readonly CaseHistorySummary[] }) {
  return (
    <main className="history-shell">
      <header className="history-header">
        <div>
          <p className="eyebrow">我的案件</p>
          <h1>歷史租屋案件</h1>
          <p>在這裡查看目前帳戶保存的租屋案件。</p>
        </div>
        <Link className="secondary-button" href="/">
          返回
        </Link>
      </header>
      {cases.length === 0 ? (
        <section className="history-empty" aria-labelledby="history-empty-title">
          <h2 id="history-empty-title">目前沒有已保存案件</h2>
          <p>建立新案件後，就能在這裡繼續查看與管理。</p>
        </section>
      ) : (
        <ul className="history-list" aria-label="帳戶擁有的租屋案件">
          {cases.map((rentalCase) => (
            <li key={rentalCase.caseId}>
              <Link href={`/history/${encodeURIComponent(rentalCase.caseId)}`}>
                <span>
                  <strong>{rentalCase.displayName}</strong>
                  <small>更新：{formatHistoryTimestamp(rentalCase.updatedAt)}</small>
                </span>
                <span className="status-pill">{historyStatusLabel(rentalCase.status)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
