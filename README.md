# 租得明白 RentProof

RentProof 協助租屋者在付訂金或簽約前，把廣告、看屋照片、租約與官方資料放在一起核對。它會指出已有證據支持、內容互相矛盾，以及仍需補充證據的事項。

> RentProof 提供資訊整理與待確認事項，不是法律意見，也不會直接判定詐騙、違法、漏水、結構安全或責任歸屬。

## 為什麼需要 RentProof

租屋資訊通常散落在不同地方：廣告寫了設備與費用，看屋時看到的是另一部分，最後租約又可能使用不同文字。RentProof 讓每項承諾都能連回來源，並在付款前提醒使用者應詢問、補拍、補件或寫入附件的內容。

## 主要功能

- 整理廣告中的租金、費用、設備與承諾。
- 分析 JPEG／PNG 看屋照片與文字型 PDF 租約。
- 以「支持、矛盾、證據不足」呈現廣告、現場與租約的差異。
- 依內政部等官方來源提供中立的條款差異檢查。
- 整理固定月費、用量費用與一次性費用。
- 顯示付款前風險訊號與非自然死亡揭露的待確認事項。
- 以對話方式引導操作，並提供證據工作區與可列印報告。
- 可選擇註冊／登入，以保存及查詢自己的案件；未登入也能使用。

## 系統架構

```text
瀏覽器（Next.js／React）
        │
        ▼
Server Routes ── 身分驗證、權限、上傳與安全檢查
        │
        ▼
Application ── 固定分析流程與案件狀態
        │
        ├── Domain ── 證據、三態結果、規則與報告
        └── Adapters ── OpenAI、PDF.js、Sharp、PostgreSQL、私有檔案儲存
```

Listing、Viewing、Evidence、Contract 四個 Agent 名稱代表固定處理階段，不是可自行操作外部系統的自治服務。模型只負責抽取候選資料及解釋已驗證的內容；分類、規則、金額與優先順序由伺服器程式決定。

## 技術

- Node.js 24 LTS、pnpm、TypeScript 6
- Next.js 16 App Router、React 19、Zod
- OpenAI Responses API
- Mozilla PDF.js、Sharp
- PostgreSQL、Kysely、node-postgres、Argon2id
- Vitest、Testing Library、axe、Playwright

完整設計見[系統架構](docs/SYSTEM_ARCHITECTURE.md)、[安全與隱私](docs/SECURITY_PRIVACY.md)及[Server 配置](docs/SERVER_CONFIGURATION.md)。

## 開始使用

需求：Node.js 24.20.0 與 pnpm 11.25.0。

```powershell
pnpm install --frozen-lockfile
pnpm env:check
pnpm dev
```

本機開發網址為 `http://127.0.0.1:3000`。HTTP 只綁定本機；區域網路使用獨立的 HTTPS 設定，不提供 HTTP LAN 模式。

執行品質檢查：

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm security:check
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` 前必須先完成 `pnpm build`。OpenAI 付費測試不會由一般啟動或 CI 自動執行；只有明確設定 Live 模式後，才會由 Server 呼叫 OpenAI。

### 區域網路 HTTPS

區域網路展示使用 `lan_secure_demo`，預設網址格式為 `https://<私人IP>:3443`。它需要受信任的本機 CA／Server 憑證、精確 Host／Origin、Private-profile Firewall、loopback PostgreSQL、自建登入與受保護的私有資料目錄。

```powershell
pnpm secure-lan:firewall:verify
pnpm start:secure-lan
```

完整建立、憑證信任、Firewall 啟停與結束清理步驟見 [Server 配置](docs/SERVER_CONFIGURATION.md)。請勿設定 `0.0.0.0`、Router Port Forwarding、UPnP、DMZ 或公開 Tunnel。

## 設定 OpenAI

將 `OPENAI_API_KEY` 放在未提交的 `.env.local`，不要使用 `NEXT_PUBLIC_*` 變數。模型固定由 Server 設定：對話使用 `gpt-5.6-luna`，證據抽取使用 `gpt-5.6-terra`。每次請求使用 `store: false`，但這不等同 OpenAI 的 Zero Data Retention。

範例環境變數見 [.env.example](.env.example)，詳細限制見 [OpenAI 整合](docs/OPENAI_INTEGRATION.md)。

## 資料與安全限制

- 上傳原檔不放在 `public/`，並驗證 MIME、大小、檔名、雜湊及來源定位。
- 圖片會重新編碼並移除 EXIF、GPS 等中繼資料。
- PDF 只接受清楚的文字型文件；掃描 OCR 與影片尚未納入目前版本。
- 密碼、OTP、API key、Session token、完整金融帳號、私人金鑰與 QR／data URL 會被阻擋。
- OpenAI 輸出必須通過 schema 與來源定位驗證，不能直接修改案件事實。
- 政策文件目前仍是草案；缺少營運者法定資訊與法務／隱私審閱前，不代表正式服務條款。

目前仍待完成的正式上線項目包括 Transactional Email、Production 私有物件儲存、刪除／清理排程、異地加密備份、正式網域與憑證，以及台灣法務與隱私審閱。

## 資料與授權

Repository 不包含真實租約、地址、身分證件、私人照片、密碼、API key、資料庫內容或 TLS 私鑰。展示素材存放在 repository 外，不隨原始碼發布。

- 原始碼授權：[Apache License 2.0](LICENSE)
- 必要聲明：[NOTICE](NOTICE)
- 第三方套件：[第三方授權盤點](docs/THIRD_PARTY_LICENSES.md)
- 模型、官方資料與素材：[來源與揭露](docs/SOURCES_AND_ATTRIBUTIONS.md)
- 公開儲存庫檢查：[交付檢查表](docs/PUBLIC_REPOSITORY_CHECKLIST.md)

## 文件

- [產品規格](docs/PRODUCT_SPEC.md)
- [系統架構](docs/SYSTEM_ARCHITECTURE.md)
- [UI／RWD 設計](docs/UI_DESIGN.md)
- [帳戶與歷史資料](docs/AUTH_AND_HISTORY.md)
- [官方規則與資料來源](docs/OFFICIAL_RULES.md)
- [Demo 與測試計畫](docs/DEMO_TEST_PLAN.md)
- [隱私政策草案](docs/PRIVACY_POLICY_DRAFT.md)
- [使用條款草案](docs/TERMS_OF_USE_DRAFT.md)
- [Cookie 政策草案](docs/COOKIE_POLICY_DRAFT.md)
