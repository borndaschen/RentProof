import { LegalPage } from "@/components/legal/legal-page";

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie 政策草案">
      <h2>目前版本</h2>
      <p>目前版本不使用分析或行銷 Cookie，也不使用追蹤像素、廣告識別碼或第三方分析工具。</p>
      <h2>必要 Cookie</h2>
      <p>
        服務可能使用維持訪客或登入狀態、防止偽造操作及記住安全偏好所必要的 Cookie。這類 Cookie
        不用於廣告，並會採用適合目前連線環境的安全設定。
      </p>
      <h2>非必要 Cookie</h2>
      <p>
        第一版不放置非必要
        Cookie。若未來新增，將先更新本政策，提供獨立選擇，不預先勾選，也不把拒絕作為使用核心功能的門檻。
      </p>
      <h2>開發版提醒</h2>
      <p>
        本機展示只使用虛構資料；私人網路展示則必須使用受信任的加密連線。正式服務上線前，仍須完成營運資訊與法務、隱私審閱。
      </p>
    </LegalPage>
  );
}
