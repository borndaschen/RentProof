import Link from "next/link";
import type { CaseHistoryDetail as CaseHistoryDetailModel } from "@/application/history";

export function HistoryDetail({ rentalCase }: { rentalCase: CaseHistoryDetailModel }) {
  return (
    <main className="history-shell">
      <Link className="legal-back" href="/history">
        ← 返回歷史案件
      </Link>
      <article className="history-detail">
        <p className="eyebrow">OWNER-SCOPED CASE</p>
        <h1>{rentalCase.displayName}</h1>
        <p>這是帳戶擁有的 Synthetic Demo 案件摘要，不包含原始認證或資料庫識別資訊。</p>
        <dl>
          <div>
            <dt>案件狀態</dt>
            <dd>{rentalCase.status}</dd>
          </div>
          <div>
            <dt>資料版本</dt>
            <dd>{rentalCase.revision}</dd>
          </div>
          <div>
            <dt>分析來源</dt>
            <dd>{rentalCase.sourceMode === "fixture" ? "Fixture" : "OpenAI Live"}</dd>
          </div>
          <div>
            <dt>建立時間</dt>
            <dd>{rentalCase.createdAt}</dd>
          </div>
          <div>
            <dt>更新時間</dt>
            <dd>{rentalCase.updatedAt}</dd>
          </div>
        </dl>
      </article>
    </main>
  );
}
