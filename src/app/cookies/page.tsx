import { LegalPage } from "@/components/legal/legal-page";

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie 政策草案">
      <h2>目前版本</h2>
      <p>
        P0 Fixture 開發版不啟用 analytics 或 marketing
        Cookie。頁面不使用追蹤像素、廣告識別碼或第三方分析工具。
      </p>
      <h2>必要 Cookie</h2>
      <p>
        未來真實資料版可能使用維持 Guest 或登入狀態、CSRF 防護與安全偏好所必要的 Cookie。這類 Cookie
        不用於廣告，並會依部署環境設定 Secure、HttpOnly 與 SameSite。
      </p>
      <h2>非必要 Cookie</h2>
      <p>
        第一版不放置非必要
        Cookie。若未來新增，將先更新本政策，提供獨立選擇，不預先勾選，也不把拒絕作為使用核心功能的門檻。
      </p>
      <h2>開發版提醒</h2>
      <p>
        私人 LAN 使用 HTTP，不承載帳戶密碼、Email reset、7 天 account session 或真實 Guest
        session。Production 仍必須使用 HTTPS。
      </p>
    </LegalPage>
  );
}
