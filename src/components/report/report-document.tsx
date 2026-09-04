import type { PreSigningReport } from "@/domain/reporting";
import { OFFICIAL_RULE_TITLES, OfficialRuleIdSchema } from "@/domain/official-rules";
import { NonNaturalDeathDisclosureSection } from "./non-natural-death-disclosure-section";
import { PrintReportButton } from "./print-button";
import { ReportSourceLinks } from "./report-source-links";

const evidenceLabels = {
  supported: "支持",
  contradicted: "矛盾",
  insufficient_evidence: "證據不足",
} as const;

const actionLabels = {
  ask: "詢問並留下書面紀錄",
  photograph: "補拍指定範圍",
  modify: "修改契約或確認內容",
  attach: "補入附件或文件",
  verify: "付款前查證",
} as const;

const completionLabels = {
  written_answer_recorded: "已取得並保存可核對的書面回答",
  requested_photos_attached_and_located: "指定照片已補齊且可定位",
  contract_or_confirmation_updated_and_attached: "修改內容已寫入契約或確認附件",
  requested_document_attached_and_verified: "文件已補齊並完成來源核對",
  payment_request_verified_before_payment: "付款前已核對身分、標的與付款要求",
} as const;

const unitLabels = {
  kwh: "度",
  water_unit: "用水單位",
  day: "日",
  use: "次",
  other: "單位",
} as const;

function money(minorUnits: string): string {
  return `NT$ ${BigInt(minorUnits).toLocaleString("zh-TW")}`;
}

function officialRuleTitle(ruleId: string): string {
  const parsed = OfficialRuleIdSchema.safeParse(ruleId);
  return parsed.success ? OFFICIAL_RULE_TITLES[parsed.data] : "未命名規則";
}

function ruleActionLabel(action: PreSigningReport["actions"][number] | undefined): string {
  return action === undefined ? "目前無新增行動" : actionLabels[action.actionType];
}

export function ReportDocument({ report }: { report: PreSigningReport }) {
  const evidenceGroups = [
    ["supported", report.evidence.supported],
    ["contradicted", report.evidence.contradicted],
    ["insufficient_evidence", report.evidence.insufficientEvidence],
  ] as const;
  const ruleRows = [
    ...report.officialRules.noDifferenceFound.map((item) => ({
      ...item,
      resultLabel: "未發現差異",
    })),
    ...report.officialRules.possibleDifference.map((item) => ({
      ...item,
      resultLabel: "疑似差異",
    })),
    ...report.officialRules.missingInformation.map((item) => ({
      ...item,
      resultLabel: "資料不足",
    })),
  ].sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  const topActions = report.actions.slice(0, 3);
  const ruleActions = new Map(
    report.actions
      .filter((action) => action.target.kind === "rule_check")
      .map((action) => [action.target.refId, action] as const),
  );

  return (
    <main className="report-shell">
      <header className="report-hero">
        <div>
          <p className="eyebrow">RentProof｜虛構範例報告</p>
          <h1>簽約前確認報告</h1>
          <p className="subtitle">把廣告、現場、契約與付款要求連回可定位來源。</p>
        </div>
        <PrintReportButton />
      </header>

      <aside className="report-disclaimer" aria-label="報告使用限制">
        <strong>這不是法律意見，也不是詐騙判決。</strong>
        <span>本頁資料完全虛構，僅供展示證據差異與付款前查證流程。</span>
      </aside>

      <section className="report-section" aria-labelledby="evidence-heading">
        <div className="report-section-heading">
          <div>
            <p className="eyebrow">廣告承諾與證據</p>
            <h2 id="evidence-heading">支持、矛盾與證據不足</h2>
          </div>
          <p>沒有拍到只代表證據不足，不代表設備不存在。</p>
        </div>
        <div className="report-status-grid">
          {evidenceGroups.map(([status, items]) => (
            <article className={`report-status report-status-${status}`} key={status}>
              <h3>{evidenceLabels[status]}</h3>
              <p>{items.length} 項</p>
              {items.map((item) => (
                <div className="report-result" key={item.findingId}>
                  <strong>{item.reasonCode}</strong>
                  <ReportSourceLinks report={report} refs={item.sourceRefs} />
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section className="report-section" aria-labelledby="rules-heading">
        <div className="report-section-heading">
          <div>
            <p className="eyebrow">官方規則檢查</p>
            <h2 id="rules-heading">中立差異結果</h2>
          </div>
          <p>結果僅表示目前資料中的差異狀態，仍需人工確認。</p>
        </div>
        <div className="report-rule-legend" aria-label="官方規則結果說明">
          <span>未發現差異</span>
          <span>疑似差異</span>
          <span>資料不足</span>
        </div>
        <div className="report-table-wrap">
          <table>
            <caption>本次官方規則檢查</caption>
            <thead>
              <tr>
                <th scope="col">規則</th>
                <th scope="col">結果</th>
                <th scope="col">官方來源</th>
                <th scope="col">簽約前行動</th>
              </tr>
            </thead>
            <tbody>
              {ruleRows.map((item) => (
                <tr key={item.ruleId}>
                  <th scope="row">
                    <span className="report-rule-id">{item.ruleId}</span>
                    <span>{officialRuleTitle(item.ruleId)}</span>
                  </th>
                  <td>{item.resultLabel}</td>
                  <td>
                    <a href={item.officialSource.url}>
                      {item.officialSource.publisher}：{item.officialSource.ruleLocator}
                    </a>
                  </td>
                  <td>{ruleActionLabel(ruleActions.get(item.ruleId))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="report-section report-payment" aria-labelledby="payment-heading">
        <p className="eyebrow">付款前查證</p>
        <h2 id="payment-heading">付款前先停下並核對</h2>
        <p>系統只顯示可定位的付款要求與查證行動，不對人物或帳戶下結論。</p>
        {report.paymentVerification.map((item) => (
          <ReportSourceLinks key={item.signalId} report={report} refs={item.sourceRefs} />
        ))}
      </section>

      <NonNaturalDeathDisclosureSection report={report} />

      <section className="report-section" aria-labelledby="cost-heading">
        <div className="report-section-heading">
          <div>
            <p className="eyebrow">居住成本</p>
            <h2 id="cost-heading">固定、變動與一次性費用</h2>
          </div>
        </div>
        <div className="report-cost-grid">
          <article>
            <h3>固定月費</h3>
            {report.costs.fixedMonthly.items.map((item) => (
              <p key={item.id}>
                <span>{item.label}</span>
                <strong>{money(item.amount.minorUnits)}</strong>
              </p>
            ))}
            <p className="report-total">
              <span>已知固定月費</span>
              <strong>{money(report.costs.fixedMonthly.total.minorUnits)}</strong>
            </p>
          </article>
          <article>
            <h3>依使用量變動</h3>
            {report.costs.variable.map((item) => (
              <p key={item.id}>
                <span>{item.label}</span>
                <strong>
                  {item.formula.minorUnitsPerUnit} 元／{unitLabels[item.formula.unit]} × 實際用量
                </strong>
              </p>
            ))}
            <small>未提供用量，因此不產生單一完整月總額。</small>
          </article>
          <article>
            <h3>一次性費用</h3>
            {report.costs.oneTime.items.map((item) => (
              <p key={item.id}>
                <span>{item.label}</span>
                <strong>{money(item.amount.minorUnits)}</strong>
              </p>
            ))}
            <p className="report-total">
              <span>一次性合計</span>
              <strong>{money(report.costs.oneTime.total.minorUnits)}</strong>
            </p>
          </article>
        </div>
      </section>

      <section className="report-section" aria-labelledby="actions-heading">
        <div className="report-section-heading">
          <div>
            <p className="eyebrow">簽約前清單</p>
            <h2 id="actions-heading">{topActions.length} 項優先確認行動</h2>
          </div>
        </div>
        <ol className="report-action-list">
          {topActions.map((action) => (
            <li key={action.actionId}>
              <div>
                <span className="status-pill">優先序 {action.priority}</span>
                <h3>{actionLabels[action.actionType]}</h3>
              </div>
              <ul className="report-completion-list" aria-label="完成條件">
                {action.completionConditions.map((condition) => (
                  <li key={condition}>{completionLabels[condition]}</li>
                ))}
              </ul>
              <ReportSourceLinks report={report} refs={action.sourceRefs} />
            </li>
          ))}
        </ol>
        {report.actions.length > topActions.length ? (
          <p className="report-more-actions">
            另有 {report.actions.length - topActions.length} 項補件事項，保留於完整結構化報告。
          </p>
        ) : null}
      </section>

      <section
        className="report-section report-provenance"
        id="report-sources"
        aria-labelledby="provenance-heading"
      >
        <p className="eyebrow">列印與核對資訊</p>
        <h2 id="provenance-heading">資料版本與完整性</h2>
        <dl>
          <div>
            <dt>分析結果版本</dt>
            <dd>
              {report.provenance.snapshotId} · {report.provenance.snapshotVersion}
            </dd>
          </div>
          <div>
            <dt>分析結果完整性碼</dt>
            <dd>{report.provenance.snapshotHash}</dd>
          </div>
          <div>
            <dt>素材清單版本</dt>
            <dd>
              {report.provenance.manifestVersion} · {report.provenance.manifestSchema}
            </dd>
          </div>
          <div>
            <dt>素材清單完整性碼</dt>
            <dd>{report.provenance.manifestHash}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
