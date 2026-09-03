# 來源、模型、資料與素材揭露

本文件說明公開 RentProof source repository 使用或參考的第三方軟體、雲端模型、官方資料與展示素材。RentProof 原始碼採 [Apache License 2.0](../LICENSE)；這不會改變第三方內容原本的權利或服務條款。

## 軟體套件

直接與間接套件的鎖定版本、授權類型與查核方式記錄於[第三方套件授權盤點](THIRD_PARTY_LICENSES.md)及`pnpm-lock.yaml`。發布binary、container或installer前仍須依實際交付內容重新產生授權清冊並保留各套件隨附的License／Notice。

## OpenAI模型與服務

- RentProof的Server adapter支援OpenAI Responses API。
- 對話意圖與說明route設定為`gpt-5.6-luna`，證據抽取route設定為`gpt-5.6-terra`；實際可用性與計價仍以使用者自己的OpenAI Project為準。
- Repository只包含整合程式、prompt/schema版本與空白環境變數範例，不包含模型權重、OpenAI API Key、Provider response或使用者資料。
- OpenAI Node SDK依其Apache-2.0授權使用；OpenAI雲端模型與服務不因本repository的Apache-2.0授權而被重新授權。

## 官方規則與資料來源

規則來源、發布機關、原始HTTPS URL、查核日期與SHA-256記錄於：

- [`rules/official-rules.v1.yaml`](../rules/official-rules.v1.yaml)
- [`rules/snapshots/2026-09-01/manifest.json`](../rules/snapshots/2026-09-01/manifest.json)
- [官方規則與資料來源](OFFICIAL_RULES.md)

內政部與行政院的政府網站資料開放宣告原則上允許在標示出處的情況下重製、改作及公開傳輸，但特別聲明或含第三方權利的影音、圖像與專案內容可能排除。為降低不必要的再散布風險，公開repository只提交來源metadata、雜湊、規則定義與自行撰寫的測試，不提交抓取的完整HTML及PDF副本。使用者可由manifest中的官方URL取得最新版本。

參考授權聲明：

- 內政部政府網站資料開放宣告：https://www.moi.gov.tw/cp.aspx?n=10954
- 行政院政府網站資料開放宣告：https://www.ey.gov.tw/Page/2EADDBFEDDB6357E

規則內容仍是工程用草案，不是法律意見；公開展示前必須重新查核官方版本。

## 測試素材

- 測試用廣告、契約、照片、人工預期結果與預先分析結果位於repository外的`RentProof-Demo`資料夾。
- 這些素材由本專案自行建立作測試用途，不會隨公開source repository散布。
- Manifest version、檔案種類、bytes及SHA-256只用於本機完整性驗證，不代表第三方素材授權。
- 真實租約、地址、姓名、電話、臉孔、證件、帳號與使用者上傳檔案禁止提交到repository。

## 本機憑證與私密執行資料

本機HTTPS憑證、Root CA私鑰、`.env.*`、PostgreSQL資料、Runtime、upload、coverage、Playwright結果與套件快取均由`.gitignore`排除。公開repository不提供或信任任何本機Root CA；每位開發者必須自行建立並保管測試憑證。
