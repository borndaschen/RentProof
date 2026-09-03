# RentProof Cookie 政策草案

- 狀態：產品／技術草案，尚未對外生效
- 草案版本：`cookie-draft-0.2`
- 日期：2026-09-03
- 預設策略：必要 Cookie only

> 本文件描述未來正式服務的隱私優先設計，不是目前已生效的法律文件。

### 正式發布前尚待完成

- 正式網域，以及正式環境的Cookie掃描與用途inventory複核。
- 營運者及Cookie／隱私聯絡方式。
- 實作後的瀏覽器掃描、供應商清單、同意要求及台灣法律／隱私審閱。

本機HTTP只允許`local_development` loopback。區域網路`lan_secure_demo`使用HTTPS，帳戶與訪客Cookie必須為Secure／HttpOnly、host-only並使用明確SameSite；舊HTTP LAN profile已退役。

## 1. 什麼是 Cookie

Cookie 是網站由瀏覽器保存並在後續 request 帶回的小型資料。RentProof 只計畫在登入、安全與保存 Cookie 選擇所必要的範圍使用 Cookie；租約原文、看屋照片、OpenAI API key、登入密碼或完整分析結果不得放進 Cookie。

## 2. 預設使用方式

| 類別              | 第一個正式版本 | 用途                                                              | 是否可關閉                                                 |
| ----------------- | -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| 必要 session      | 啟用           | 維持 server-side guest／登入 session；browser 只持有 opaque token | 使用 active case／登入功能時必要；可刪除 Cookie 或登出終止 |
| 安全／CSRF        | 啟用           | 驗證 mutation request、降低跨站請求與濫用                         | 使用受保護功能時必要                                       |
| Cookie preference | 視實作啟用     | 保存使用者非必要 Cookie 選擇與政策版本                            | 可清除；清除後重新詢問                                     |
| 功能偏好          | 預設停用       | 只有在確有必要且不含案件內容時才加入                              | 可選擇                                                     |
| Analytics／效能   | 不啟用         | 第一版不使用第三方 analytics Cookie                               | 未經 opt-in 不載入                                         |
| Marketing／廣告   | 不啟用         | 不建立廣告受眾或跨站追蹤                                          | 不提供                                                     |

OpenAI API 呼叫由 RentProof server／worker 發出，不讓瀏覽器直接連 OpenAI，因此 OpenAI 不應因 RentProof 的分析 request 在使用者瀏覽器設定 Cookie。

Self-hosted Auth只使用RentProof第一方Cookie；未來若Email、CDN或其他供應商加入會設定Cookie的嵌入式資源，必須先逐一列入inventory、CSP、資料地區與同意審查，不能以「由供應商設定」為由省略揭露。

## 3. Cookie inventory

目前程式使用下列第一方Cookie；正式網域上線前仍須以瀏覽器掃描複核，政策、測試與實際行為必須一致：

| 實際名稱                   | Provider  | First／third party | Purpose                     | Data                        | Duration                   | Secure | HttpOnly | SameSite |
| -------------------------- | --------- | ------------------ | --------------------------- | --------------------------- | -------------------------- | ------ | -------- | -------- |
| `__Host-rentproof_account` | RentProof | First party        | Self-hosted account session | 32-byte CSPRNG opaque token | 7天sliding idle expiry     | yes    | yes      | Strict   |
| `__Host-rentproof_guest`   | RentProof | First party        | 目前訪客案件 owner binding  | 32-byte CSPRNG opaque token | 自建立起固定24小時；不滑動 | yes    | yes      | Strict   |
| `__Host-rentproof_csrf`    | RentProof | First party        | CSRF validation             | opaque random token         | 由目前安全設定控制         | yes    | no       | Strict   |
| `__Host-rentproof_preauth` | RentProof | First party        | 註冊／驗證流程的瀏覽器綁定  | opaque random token         | 短期                       | yes    | yes      | Strict   |
| `__Host-rentproof_reset`   | RentProof | First party        | 密碼重設流程綁定            | opaque random token         | 短期                       | yes    | yes      | Strict   |

規則：

- HTTPS區域網路使用上述`__Host-` Cookie；本機loopback開發使用對應的`*_dev`名稱且不對區域網路開放。
- Cookie 不得保存 email、user ID 明文、case ID、租約內容、圖片、findings、private storage key 或 OpenAI token。
- Session token在server database只保存以獨立server key計算的HMAC-SHA-256 digest，登入／權限變更後rotate，登出時server-side revoke。
- Account Session為7天sliding idle expiry；只有合格主動使用以原子DB更新延長並在同一成功response刷新Cookie。Guest Session自建立起固定24小時且不滑動，到期後相關線上案件資料於24小時內purge。
- 不把 session／refresh token、案件資料或報告放入 `localStorage`、`sessionStorage` 或 IndexedDB。

## 4. 非必要 Cookie 的選擇

第一版採必要 Cookie only，因此不顯示誤導性的「全部接受」banner。若未來加入 analytics 或功能 Cookie：

1. 預設關閉，選項不預先勾選。
2. 在 Cookie 設定中按類別說明目的、provider、期限與資料。
3. 「只使用必要 Cookie」與「接受所選項目」同等清楚。
4. 使用者可隨時撤回或修改；撤回後停止未來載入，並在可行範圍移除既有非必要 Cookie。
5. 非必要 Cookie 不得在選擇前由 tag manager、script、pixel 或第三方 iframe 提前設定。
6. Cookie 選擇不與使用條款、隱私告知或 OpenAI Cloud Processing Notice 綁在同一勾選框。

是否依法需要同意、何種 Cookie 屬必要與紀錄保存範圍，須依實際技術與適用法令由隱私／法律審閱確認。

## 5. 瀏覽器控制

使用者可透過瀏覽器刪除／封鎖 Cookie。封鎖必要 session／安全 Cookie 可能導致無法維持訪客案件、登入、上傳或修改案件；清除guest cookie後可能無法找回未保存到帳戶的案件。目前沒有公開HTTP展示站。

## 6. 其他瀏覽器儲存與追蹤

- RentProof 不以 browser storage 保存租約、照片、findings 或報告。
- 不使用裝置 fingerprint、廣告 ID、跨網站 pixel 或隱藏追蹤連結。
- 若未來加入CDN、error monitoring、customer support widget或embedded media，必須先完成Cookie／storage掃描、供應商審閱、CSP更新與本政策更新。
- Server logs、audit events 與 OpenAI server-to-server processing 不是 Cookie，但仍受 [隱私政策草案](PRIVACY_POLICY_DRAFT.md) 與 [安全與隱私規格](SECURITY_PRIVACY.md) 管理。

## 7. 版本與變更

- Cookie inventory 隨 release 自動驗證，不能只靠人工文件。
- 新增非必要 category／provider 前必須更新政策與 consent UI，並在載入前取得所需選擇。
- 保存 `policyVersion`、preference enums、時間與 user／anonymous preference ID；預設不保存原始 IP 或裝置 fingerprint 作同意證據。
- 使用者可在網站頁尾與帳戶設定隨時開啟 Cookie 設定。

## 8. 聯絡方式

正式Cookie／隱私聯絡方式仍待營運者補齊，詳見本文件開頭。

## 9. 審閱基準

正式版應依實際 Cookie inventory、台灣個人資料保護法與服務提供地區適用規範重新審閱。政府網站的 [我的 E 政府隱私權暨資訊安全政策](https://www.gov.tw/CP_16) 可作 Cookie 告知結構的參考，但不代表 RentProof 可直接複製其法律結論或已完成合規。
