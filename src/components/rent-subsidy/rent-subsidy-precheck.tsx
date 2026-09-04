"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  SubsidyPrecheckInputSchema,
  SubsidyPrecheckResultSchema,
  type SubsidyPrecheckResult,
} from "@/domain/subsidy/schema";
import rawStyles from "./rent-subsidy-precheck.module.css";

const styles = {
  shell: rawStyles["shell"],
  header: rawStyles["header"],
  backLink: rawStyles["backLink"],
  eyebrow: rawStyles["eyebrow"],
  lead: rawStyles["lead"],
  privacyNotice: rawStyles["privacyNotice"],
  form: rawStyles["form"],
  submitArea: rawStyles["submitArea"],
  error: rawStyles["error"],
  statusGuide: rawStyles["statusGuide"],
  question: rawStyles["question"],
  questionNumber: rawStyles["questionNumber"],
  fields: rawStyles["fields"],
  inlineFieldset: rawStyles["inlineFieldset"],
  answerOptions: rawStyles["answerOptions"],
  result: rawStyles["result"],
  resultLabel: rawStyles["resultLabel"],
  checkList: rawStyles["checkList"],
  sourceLinks: rawStyles["sourceLinks"],
} as const;

const officialApplicationUrl = "https://pip.moi.gov.tw/v3/B/SCRB0102.aspx";
const cityOptions = [
  "臺北市",
  "新北市",
  "桃園市",
  "臺中市",
  "臺南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "嘉義市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
] as const;
const statusLabels = {
  preliminary_match: "初步相符",
  needs_review: "有待確認",
  insufficient_information: "資料不足",
} as const;
const criterionLabels: Readonly<
  Record<SubsidyPrecheckResult["checks"][number]["criterion"], string>
> = {
  application_window: "申請期間",
  nationality_and_registration: "國籍與戶籍條件",
  age_basis: "年齡條件",
  home_ownership: "家庭住宅持有狀態",
  income: "家庭成員平均每月所得",
  other_housing_assistance: "其他住宅補助",
  lease_timing: "租約起始時間",
  building_basis: "建物資料",
  named_leaseholder: "申請人與承租人",
  lease_genuineness: "租賃事實",
  landlord_relationship: "出租人關係",
  housing_program_type: "住宅方案類型",
  monthly_rent_cap: "每月租金上限",
  residential_use: "居住用途",
  care_institution: "24 小時照顧機構",
};
const triStateOptions = [
  ["yes", "是"],
  ["no", "否"],
  ["unknown", "還不確定"],
] as const;

export function RentSubsidyPrecheck() {
  const [result, setResult] = useState<SubsidyPrecheckResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const form = new FormData(event.currentTarget);
    const input = SubsidyPrecheckInputSchema.safeParse({
      applicationDate: textValue(form, "applicationDate") || "unknown",
      rentalCountyCity: textValue(form, "rentalCountyCity"),
      nationalityAndRegistration: textValue(form, "nationalityAndRegistration"),
      ageBasis: textValue(form, "ageBasis"),
      householdHomeOwnership: textValue(form, "householdHomeOwnership"),
      incomeThresholdBasis: textValue(form, "incomeThresholdBasis"),
      incomeComparedWithApplicableThreshold: textValue(
        form,
        "incomeComparedWithApplicableThreshold",
      ),
      otherHousingAssistance: textValue(form, "otherHousingAssistance"),
      leaseTiming: textValue(form, "leaseTiming"),
      buildingBasis: textValue(form, "buildingBasis"),
      applicantIsNamedLeaseholder: textValue(form, "applicantIsNamedLeaseholder"),
      leaseIsGenuine: textValue(form, "leaseIsGenuine"),
      landlordOrOwnerIsHouseholdMemberOrLinealRelative: textValue(
        form,
        "landlordOrOwnerIsHouseholdMemberOrLinealRelative",
      ),
      housingProgramType: textValue(form, "housingProgramType"),
      monthlyRentTwd: numberOrUnknown(form, "monthlyRentTwd"),
      leaseUseIncludesResidence: textValue(form, "leaseUseIncludesResidence"),
      is24HourCareInstitution: textValue(form, "is24HourCareInstitution"),
    });
    if (!input.success) {
      setError("請先選擇租屋縣市，並確認金額只填整數；其他不知道的項目可以保留為「還不確定」。");
      return;
    }
    setIsSubmitting(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/rent-subsidy/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "rentproof.rent-subsidy-precheck-input.v1",
          input: input.data,
        }),
      });
      const parsed = SubsidyPrecheckResultSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("INVALID_PRECHECK_RESPONSE");
      setResult(parsed.data);
    } catch {
      setError("目前無法完成預檢，沒有產生資格結論。請稍後重試，或直接前往官方網站確認。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.backLink} href="/">
          ← 返回 RentProof
        </Link>
        <p className={styles.eyebrow}>115 年度・申請準備</p>
        <h1>租屋補助申請條件預檢</h1>
        <p className={styles.lead}>
          用 8 組問題整理申請條件。這不是政府資格認定，最終結果與金額仍以主管機關審查為準。
        </p>
      </header>
      <aside className={styles.privacyNotice} aria-labelledby="privacy-title">
        <h2 id="privacy-title">先保護你的資料</h2>
        <p>
          不需要姓名、身分證字號、詳細地址或證明文件。所得只回答是否已依官方表格完成門檻核對；請勿上傳文件或輸入其他個資。
        </p>
      </aside>
      <form className={styles.form} onSubmit={submit}>
        <Question number={1} title="申請時間與租屋地點">
          <label htmlFor="application-date">預計申請日期（不知道可留空）</label>
          <input
            id="application-date"
            name="applicationDate"
            type="date"
            min="2026-01-01"
            max="2026-12-31"
          />
          <label htmlFor="rental-county-city">租屋處縣市</label>
          <select id="rental-county-city" name="rentalCountyCity" required defaultValue="">
            <option value="">請選擇縣市</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </Question>
        <Question number={2} title="申請人基本條件">
          <SelectField
            label="國籍與戶籍狀態"
            name="nationalityAndRegistration"
            options={[
              ["roc_national_with_domestic_household_registration", "中華民國國民且在國內設有戶籍"],
              ["other", "其他情況"],
              ["unknown", "還不確定"],
            ]}
          />
          <SelectField
            label="年齡條件"
            name="ageBasis"
            options={[
              ["adult", "已成年"],
              ["listed_minor_exception", "未成年但可能符合官方例外"],
              ["other_minor", "未成年且不確定符合例外"],
              ["unknown", "還不確定"],
            ]}
          />
        </Question>
        <Question number={3} title="家庭住宅持有狀態">
          <SelectField
            label="最接近目前情況的是？"
            name="householdHomeOwnership"
            options={[
              ["no_self_owned_home", "家庭成員均無自有住宅"],
              [
                "shared_under_40_sqm_with_non_household_coowners",
                "與非家庭成員共有且持分換算未滿 40 平方公尺",
              ],
              ["announced_demolition_or_dangerous_building", "住宅經公告拆遷或屬危險建物"],
              ["over_half_damaged_requires_repair", "住宅毀損逾半且需修復"],
              ["other_self_owned_home", "其他持有自有住宅情況"],
              ["unknown", "還不確定"],
            ]}
          />
        </Question>
        <Question number={4} title="家庭所得">
          <SelectField
            label="所得門檻基準"
            name="incomeThresholdBasis"
            options={[
              ["standard", "一般家庭"],
              ["newlywed_or_household_with_minor_child", "新婚或育有未成年子女家庭"],
              ["unknown", "還不確定"],
            ]}
          />
          <SelectField
            label="家庭成員平均每月所得與所在地門檻比較"
            name="incomeComparedWithApplicableThreshold"
            options={[
              ["below", "已依官方表格核對，低於適用門檻"],
              ["at_or_above", "已依官方表格核對，等於或高於適用門檻"],
              ["unknown", "尚未核對／還不確定"],
            ]}
          />
        </Question>
        <Question number={5} title="其他住宅協助">
          <SelectField
            label="目前領取狀況"
            name="otherHousingAssistance"
            options={[
              ["none", "沒有領取其他住宅協助"],
              ["other_rent_subsidy_will_relinquish", "有其他租金補貼，預計切結放棄"],
              [
                "qualifying_social_housing_subsidy_will_relinquish",
                "符合例外的社宅補助，預計切結放棄",
              ],
              [
                "assistance_received_only_by_non_applicant_household_member",
                "僅非申請人的家庭成員領取",
              ],
              ["minor_student_dormitory_subsidy", "未成年子女領取學生宿舍補助"],
              ["receiving_without_confirmed_exception", "正在領取且尚未確認例外"],
              ["unknown", "還不確定"],
            ]}
          />
        </Question>
        <Question number={6} title="租約與建物範圍">
          <SelectField
            label="租約時間"
            name="leaseTiming"
            options={[
              [
                "started_or_starts_within_60_days_and_in_2026",
                "租約已開始，或申請日起 60 日內開始，且租期落在 2026 年",
              ],
              ["outside_allowed_timing", "不符合上述時間"],
              ["unknown", "還不確定"],
            ]}
          />
          <SelectField
            label="建物資料"
            name="buildingBasis"
            options={[
              [
                "qualifying_tax_registration_or_legal_building_proof",
                "已有房屋稅籍或符合官方要求的建物證明",
              ],
              ["same_address_114_carryover_exception", "可能符合 114 年度同址續租例外"],
              ["not_confirmed_qualifying", "尚未確認有符合的建物資料"],
              ["unknown", "還不確定"],
            ]}
          />
          <SelectField
            label="住宅方案類型"
            name="housingProgramType"
            options={[
              ["ordinary_or_officially_allowed_exception", "一般租屋或官方允許的例外"],
              [
                "disallowed_social_or_government_rental_housing",
                "社會住宅或政府出租住宅，且未確認例外",
              ],
              ["unknown", "還不確定"],
            ]}
          />
        </Question>
        <Question number={7} title="契約當事人與租賃事實">
          <TriStateField label="申請人是否為租約上的承租人？" name="applicantIsNamedLeaseholder" />
          <TriStateField label="是否確實有租賃及支付租金的事實？" name="leaseIsGenuine" />
          <TriStateField
            label="出租人或房屋所有權人是否為家庭成員或直系親屬？"
            name="landlordOrOwnerIsHouseholdMemberOrLinealRelative"
          />
        </Question>
        <Question number={8} title="租金與使用方式">
          <label htmlFor="monthly-rent">每月租金（新臺幣；不知道可留空）</label>
          <input
            id="monthly-rent"
            name="monthlyRentTwd"
            type="number"
            min="1"
            max="100000000"
            step="1"
            inputMode="numeric"
          />
          <TriStateField label="租約用途是否包含居住？" name="leaseUseIncludesResidence" />
          <TriStateField
            label="租屋處是否為提供 24 小時照顧的機構？"
            name="is24HourCareInstitution"
          />
        </Question>
        <div className={styles.submitArea}>
          <p>送出後由 Server 的版本化規則檢查；瀏覽器不會自行判斷資格。</p>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "正在檢查…" : "查看預檢結果"}
          </button>
        </div>
      </form>
      {error ? (
        <section className={styles.error} role="alert">
          <h2>預檢未完成</h2>
          <p>{error}</p>
        </section>
      ) : null}
      {result ? <PrecheckResult result={result} /> : null}
      <section className={styles.statusGuide} aria-labelledby="status-guide-title">
        <h2 id="status-guide-title">結果怎麼看</h2>
        <dl>
          <div>
            <dt>初步相符</dt>
            <dd>目前自述資料與預檢規則相符；仍須由主管機關正式審查。</dd>
          </div>
          <div>
            <dt>有待確認</dt>
            <dd>至少一項情況需要向官方或承辦單位確認。</dd>
          </div>
          <div>
            <dt>資料不足</dt>
            <dd>目前回答不足以完成部分檢核，需先補齊資料。</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

function Question({
  number,
  title,
  children,
}: Readonly<{ number: number; title: string; children: React.ReactNode }>) {
  return (
    <fieldset className={styles.question}>
      <div className={styles.questionNumber}>問題 {number}／8</div>
      <legend>{title}</legend>
      <div className={styles.fields}>{children}</div>
    </fieldset>
  );
}
function SelectField({
  label,
  name,
  options,
}: Readonly<{ label: string; name: string; options: ReadonlyArray<readonly [string, string]> }>) {
  return (
    <label>
      {label}
      <select name={name} defaultValue="unknown">
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
function TriStateField({ label, name }: Readonly<{ label: string; name: string }>) {
  return (
    <fieldset className={styles.inlineFieldset}>
      <legend>{label}</legend>
      <div className={styles.answerOptions}>
        {triStateOptions.map(([value, text]) => (
          <label key={value}>
            <input type="radio" name={name} value={value} defaultChecked={value === "unknown"} />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function PrecheckResult({ result }: { result: SubsidyPrecheckResult }) {
  return (
    <section className={styles.result} aria-labelledby="precheck-result-title" aria-live="polite">
      <p className={styles.resultLabel}>{statusLabels[result.overallStatus]}</p>
      <h2 id="precheck-result-title">申請條件預檢結果</h2>
      <p>
        {result.program}・規則版本 {result.rulesVersion}
      </p>
      <ul className={styles.checkList}>
        {result.checks.map((check) => (
          <li key={check.criterion}>
            <strong>{criterionLabels[check.criterion]}</strong>
            <span>
              {statusLabels[check.status]}・官方問題 {check.officialQuestionReference}
            </span>
            {check.thresholdTwd === undefined ? null : (
              <span>{thresholdLabel(check.criterion, check.thresholdTwd)}</span>
            )}
          </li>
        ))}
      </ul>
      <p>這是依自述資料產生的申請準備預檢，不是官方資格認定，仍需要人工核對與主管機關審查。</p>
      <div className={styles.sourceLinks}>
        {result.officialSources.map((source) => (
          <a key={source.sourceId} href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
        ))}
      </div>
      <a className="primary-button" href={officialApplicationUrl} target="_blank" rel="noreferrer">
        前往政府官方申請專區
      </a>
    </section>
  );
}
function textValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
function numberOrUnknown(form: FormData, name: string): number | "unknown" {
  const value = textValue(form, name);
  return value === "" ? "unknown" : Number(value);
}

function thresholdLabel(
  criterion: SubsidyPrecheckResult["checks"][number]["criterion"],
  thresholdTwd: number,
): string {
  const formatted = new Intl.NumberFormat("zh-TW").format(thresholdTwd);
  return criterion === "income"
    ? `此次預檢採用的家庭成員平均每月所得門檻：低於 NT$ ${formatted}`
    : `此次預檢採用的每月租金上限：NT$ ${formatted}`;
}
