# RentProof 優化清單

本清單只記錄仍能提升證據可靠性、使用理解、安全性或正式營運準備度的工作。展示環境可運作，不代表正式上線條件已全部完成。

## 已完成

- 廣告、照片、租約與官方規則的可定位證據模型，以及「支持／矛盾／證據不足」比較。
- 10條官方規則的確定性evaluator與回歸測試；規則內容仍是待重查與法務審閱的草案。
- `FRS-001`付款前風險訊號；不輸出詐騙判決、機率或安全分數。
- Conversation-first、mobile-first介面、四區工作區、補件流程與列印報告。
- OpenAI Responses API的server-only整合、Structured Outputs、`store: false`、用量限制與分離錯誤碼。
- PDF.js／Sharp安全處理、私有AES-256-GCM檔案儲存及PostgreSQL owner scope。
- HTTPS區域網路展示、自建Email／密碼帳戶、Email驗證／重設、7天滑動會員session。
- 未登入訪客可建立及操作案件；訪客session固定24小時且不滑動，不提供歷史查詢。
- Guest案件可在有效guest＋最近驗證account session下原子轉移，case與artifact owner同一transaction更新。
- Retention purge worker可清除到期guest、case／account deletion內容、21天tombstone與180天audit metadata；需由正式host排程。
- 個人Gmail API低量寄送adapter、最小`gmail.send` OAuth邊界、Fixture網路禁用與實際連線寄送已完成。
- Apache-2.0授權、第三方來源揭露與公開repository安全掃描。
- 租金補貼頁移除Client-side Zod／Domain runtime，保留Server strict schema與輕量display projection；首載未壓縮JavaScript由857,011降至480,456 bytes。History list／detail同樣改用輕量projection parser，首載由約850KB降至約468KB。敏感JSON routes共用no-store／nosniff helper，History與real-data requests會在元件卸載時中止。

## 尚待完成

1. 正式服務：選定Transactional Email、hosting與異地加密備份供應商；補齊處理地區、DPA及subprocessor清冊。
2. 資料治理：在正式host部署purge排程、逾期告警及備份還原tombstone重播；Production raw conversation persistence啟用前另接7日text purge target。
3. 帳戶流程：完成Gmail配額／退信監控、完整IDOR／recovery驗收與事件處理演練。
4. 政策法務：填妥營運者、聯絡方式、服務地區、未成年人、爭議處理與保存期限，並由台灣法律／隱私專業人士審閱；完成前維持DRAFT。
5. 規則治理：每次公開展示前重查官方來源，並為防詐來源建立版本化快照與SHA-256。
6. 使用體驗：在另一台實體LAN裝置完成人工RWD、鍵盤、200%縮放與screen-reader smoke。
7. 後續功能：口頭承諾、拍攝導引、掃描PDF OCR、影片抽幀、報告版本、其餘防詐訊號與受控外部查詢。

## 不做

- 「可以放心簽約」、合法／違法、詐騙與責任歸屬的自動判決。
- 房東／房客信用分數、人物或帳戶黑名單、臉部辨識與結構安全推斷。
- 自動付款、簽約、報警、封鎖或任意網址抓取；受控 allowlisted HTTPS 租屋 URL 擷取不等同任意爬取。
- 以註冊作為使用門檻，或把使用條款、隱私告知、雲端處理與Cookie選擇綁成單一同意。
- Provider失敗後偷偷切換模型或預先結果。
