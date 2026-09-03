import { NON_NATURAL_DEATH_DISCLOSURE_OFFICIAL_SOURCE } from "@/domain/non-natural-death-disclosure";
import type { PreSigningReport } from "@/domain/reporting";
import { ReportSourceLinks } from "./report-source-links";

const periodLabels = {
  during_owner_holding: "出租人持有期間",
  before_owner_holding_known: "出租人持有前且其知悉的期間",
} as const;
const statusLabels = {
  supported: "已有明確揭露資料",
  contradicted: "揭露內容互相不一致",
  insufficient_evidence: "資料不足",
} as const;
const answerLabels = {
  yes: "文件明確勾選：是",
  no: "文件明確勾選：否",
  unknown: "尚無可採用的明確勾選",
} as const;
const actionLabels = {
  obtain_signed_status_confirmation: "取得雙方簽署的租賃標的現況確認書",
  ask_landlord_or_agent_in_writing: "向出租人或仲介書面詢問兩個期間的勾選內容",
  preserve_located_source_copy: "保存文件版本、簽署狀態與可定位來源",
} as const;

export function NonNaturalDeathDisclosureSection({ report }: { report: PreSigningReport }) {
  const result = report.nonNaturalDeathDisclosure;
  return (
    <section className="report-section" aria-labelledby="non-natural-death-heading">
      <div className="report-section-heading">
        <div>
          <p className="eyebrow">租賃標的現況確認</p>
          <h2 id="non-natural-death-heading">專有部分非自然死亡揭露</h2>
        </div>
        <p>「凶宅」不是法定用語；本區只核對文件揭露與來源，不作物件判決。</p>
      </div>
      <div className="report-status-grid">
        {result.checks.map((check) => (
          <article className={`report-status report-status-${check.status}`} key={check.period}>
            <h3>{periodLabels[check.period]}</h3>
            <p>{statusLabels[check.status]}</p>
            <strong>{answerLabels[check.disclosedAnswer]}</strong>
            <small>來源定位：{check.sourceLocators.length} 筆</small>
            {check.sourceLocators.length > 0 ? (
              <ReportSourceLinks
                report={report}
                refs={check.sourceLocators.map((locator) => locator.locatorId)}
              />
            ) : null}
          </article>
        ))}
      </div>
      <h3>簽約前確認行動</h3>
      <ul className="report-completion-list">
        {result.actions.map((action) => (
          <li key={action}>{actionLabels[action]}</li>
        ))}
      </ul>
      <p>
        官方欄位來源：
        <a href={NON_NATURAL_DEATH_DISCLOSURE_OFFICIAL_SOURCE.url}>
          {NON_NATURAL_DEATH_DISCLOSURE_OFFICIAL_SOURCE.publisher}：
          {NON_NATURAL_DEATH_DISCLOSURE_OFFICIAL_SOURCE.sourceLocator}
        </a>
      </p>
      {result.excludedUnverifiedSourceCount > 0 ? (
        <p>
          有 {result.excludedUnverifiedSourceCount} 筆傳聞／搜尋／新聞／模型推測未被採為肯定事實。
        </p>
      ) : null}
    </section>
  );
}
