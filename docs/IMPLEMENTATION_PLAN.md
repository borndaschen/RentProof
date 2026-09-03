# RentProof 實作與交付計畫

- 狀態：主要展示流程已完成；正式營運工作仍待完成
- 維護方式：單人開發，依安全與驗收Gate逐項交付，不設定工時

## 目前可用

- Conversation-first網站，以自由文字與引導卡整理廣告、看屋照片、租約及補件。
- JPEG／PNG安全處理、文字型PDF解析、來源定位、三態比較、10條官方規則及可列印報告。
- OpenAI Responses API的server-only整合；對話使用Luna，證據抽取使用Terra，所有輸出通過schema與locator驗證。
- HTTP本機開發只綁`127.0.0.1`；區域網路展示只使用`lan_secure_demo` HTTPS、精確Host／Origin及Private-profile Firewall。
- 未登入訪客可建立及操作一筆案件；session固定24小時且不滑動。帳戶為選用功能，提供Email驗證、登入、密碼重設、7天滑動session與歷史案件。
- PostgreSQL使用Kysely＋node-postgres、獨立migration命令與最小權限角色；上傳檔案置於repository外的私有AES-256-GCM儲存。
- Apache-2.0授權、來源揭露、secret scan、Vitest、Playwright與accessibility Gate。

## 固定處理流程

1. 建立訪客工作階段或使用既有帳戶。
2. 建立案件並同意當次OpenAI雲端處理告知。
3. 上傳廣告圖片、看屋圖片及文字型租約PDF。
4. Listing、Viewing、Evidence、Contract固定階段抽取候選資料。
5. Server驗證schema、locator與owner後，執行比較、官方規則與風險訊號。
6. 要求必要補拍／補件，並只重跑受影響部分。
7. 產生證據工作區與可列印的簽約前報告。
8. 使用者可刪除案件；訪客到期後立即失去存取權。

四個Agent名稱只代表固定管線階段，不是自治服務。使用者訊息與模型文字不得直接修改案件事實；重要候選必須經typed command與確認卡後才套用。

## 下一階段

| 工作                | 驗收重點                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| Guest-to-user轉移   | 使用者明確確認、單一transaction改owner、失敗不產生半完成狀態                     |
| 資料清除排程        | Guest 24小時、案件／帳戶7日、raw conversation 7日；可重試、可觀測、逾期告警      |
| 異地備份與還原      | 最多14天加密保存；restore前重播21天content-free tombstone                        |
| Transactional Email | generic response、單次短效challenge、供應商／地區／DPA揭露，不新增SMS route      |
| 正式部署            | 正式網域與憑證、production secrets、最小權限roles、private storage與事件處理演練 |
| 政策與法務          | 填妥營運者、聯絡、未成年人、保存及爭議欄位；台灣法律／隱私審閱後才轉為生效文件   |
| 功能擴充            | 掃描PDF OCR、影片抽幀、口頭承諾、報告版本、其餘防詐訊號與受控外部查詢            |

## 每次交付Gate

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`與coverage門檻分開通過。
- `pnpm security:check`確認browser bundle與repository無key、token、密碼、私鑰或使用者資料。
- `pnpm build`後執行Playwright／axe；人工確認鍵盤、200%縮放、screen reader及另一台LAN裝置。
- Guest A／B、User A／B互相隔離；任何case／artifact／snapshot／report查詢均驗證owner。
- 「未拍到」仍為證據不足；明確相反證據才是矛盾；沒有locator不得產生肯定結論。
- Provider拒絕、未完成、schema錯誤、限流與權限錯誤各自顯示，不得變成「沒有問題」。
- 政策持續標示DRAFT，直到缺漏欄位與外部專業審閱確實完成。

## 不可降級的邊界

- RentProof提供證據差異與待確認事項，不提供法律意見。
- 不判定詐騙、違法、漏水、結構安全、租金合理性或責任歸屬。
- 不做臉部辨識、信用評分、人物／帳戶黑名單、自動付款或簽約。
- 帳戶不是使用門檻；訪客沒有歷史查詢，Cookie遺失後不以內容或case ID協助找回。
- API key、密碼、OTP、session token、完整金融帳號與私人金鑰不保存於案件、不寫log，也不送OpenAI。
- 不抓取任意廣告網址；URL只作來源metadata。

實際架構與安全細節以[SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)、[SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md)、[SECURITY_PRIVACY.md](SECURITY_PRIVACY.md)及[AUTH_AND_HISTORY.md](AUTH_AND_HISTORY.md)為準；最新驗證結果記錄於[DEVLOG.md](DEVLOG.md)。
