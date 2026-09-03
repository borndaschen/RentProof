import { LegalPage } from "@/components/legal/legal-page";

export default function PrivacyPage() {
  return (
    <LegalPage title="隱私政策草案">
      <h2>目前開發版的資料範圍</h2>
      <p>
        本機與私人 LAN
        此展示版只能使用範例資料，不應輸入真實姓名、地址、電話、帳號、身分文件、租約或其他可識別個人的內容。
      </p>
      <h2>對話與案件資料</h2>
      <p>
        Raw 對話文字預定最多保存 7 天；Guest 案件、Formal Demo
        結束或案件刪除等較短期限優先。到期後只保留不含內容的 opaque metadata 與已驗證 typed
        references。
      </p>
      <h2>OpenAI Cloud Processing</h2>
      <p>
        Live 模式只會由 Server 將必要、經 schema 驗證的內容送至 OpenAI Responses API，固定設定
        store: false。這項設定不等同 Zero Data Retention，也不代表正式資料治理已完成。
      </p>
      <h2>安全與限制</h2>
      <p>
        密碼、OTP、API key、session token、完整金融帳號、QR code 與 private key
        會被阻擋，不保存、不寫入
        log，也不送給模型。一般個資疑慮會要求使用者明確確認，但偵測不保證完整。
      </p>
      <h2>尚待正式決定</h2>
      <p>
        正式營運者、聯絡窗口、供應商處理地區、未成年人規則、資料主體請求流程與正式保存期限，仍需在真實資料上線前完成法務與隱私審閱。
      </p>
    </LegalPage>
  );
}
