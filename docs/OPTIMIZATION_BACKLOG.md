# RentProof 優化清單

此清單只記錄會提升證據可靠性、使用理解、安全或可展示性的優化。P0 Golden flow已實作；外部環境驗證與真實資料release仍須依Gate完成，不因程式骨架存在而視為可上線。

## 已完成的規格優化

- [x] Demo 素材移出 repository，使用 `RENTPROOF_DEMO_DIR`。
- [x] 人工 `truth/` 與模型 `fallback/` 分離。
- [x] 廣告 4 claims 與牆面 `observation_follow_up` 分離。
- [x] Claim 三態與官方規則三結果分開呈現。
- [x] Locator／Finding 改成可驗證 discriminated unions。
- [x] 規則 YAML 改用 P0 active profile＋allowlisted `evaluator_id`，不執行自由文字。
- [x] 6 個官方來源已凍結至版本化快照、建立 manifest 並回填 SHA-256。
- [x] OpenAI Cloud provider 與 `gpt-5.6-terra`／medium 決策落盤。
- [x] 新增 OpenAI data controls、API key、prompt injection 與真實資料 Security Gate。
- [x] 報告改為可完成的 action cards；補拍顯示已取得／仍缺證據。
- [x] 新增獨立詐騙風險訊號規格；P0 收斂為 `FRS-001`，不作詐騙 verdict／評分。
- [x] 建立 canonical system architecture：模組、ports／adapters、Stage DAG、snapshots、API、部署與 P1 演進。
- [x] 建立 mobile-first RWD／極簡 UI 規格，固定清晰字級、寬鬆留白、accessibility 與 print Gate。
- [x] 建立單一入口、guest session、選用登入／註冊、歷史案件與 Email／SMS 忘記密碼的架構規格。
- [x] 建立隱私政策、使用條款與 Cookie 政策草案，以及 versioned policy／purpose-scoped consent model。
- [x] 建立canonical Server配置：HTTP loopback／private LAN development、HTTP static synthetic showcase、HTTPS production、bind／Firewall／Host／Origin與synthetic hash allowlist。

## P0 已實作

- [x] 外部immutable Golden dataset：廣告、文字型租約、12張照片、補拍、synthetic interaction、truth與fallback均由manifest＋SHA-256封存。
- [x] Locator／Finding／FraudSignalCheck／ExtractedField等strict schemas、cross-reference檢查、金額decimal／minor-unit契約。
- [x] OpenAI Responses Gateway：Luna／Terra分流、Structured Outputs、`store: false`、明確Fixture／Live、usage／budget與typed provider failures。
- [x] PDF.js／Sharp安全處理、stream／MIME／magic／大小／頁數／像素／metadata／path邊界，以及secret、HTML與prompt-injection測試。
- [x] Conversation-first RWD網站、四區workspace、locator、typed cards、三態／RuleCheck分離與可列印報告。
- [x] Golden／security／provider failure／FRS-001 regression，以及desktop／mobile E2E。
- [x] Windows JSON runtime、atomic CAS、Development／Formal Demo lifecycle與固定牆面補拍局部重算。
- [x] LAN listener、Host／Origin／CSRF／CORS、synthetic manifest allowlist與persistent warning等程式Gate。

## 尚待外部驗證或release決策

1. **實體環境Gate**
   - Windows Private Firewall規則已完成UAC安裝、scope、enable／disable與本機LAN Production Build的Host／Forwarded攻擊smoke；仍須在另一台LAN裝置完成人工連線、RWD、keyboard、200% zoom與screen-reader smoke，repository測試不能取代此操作。
   - 在OpenAI Development Project人工核對Hard Spend Limit、alerts與model limits；runtime只顯示未確認警告，不能自行驗證Dashboard設定。

2. **Self-hosted Auth／PostgreSQL Demo-safe切片狀態**
   - Auth application ports、Argon2id password adapter、Email verification／reset、7天sliding session、owner-scoped history、Kysely＋node-postgres repositories與兩版凍結migration均已完成。
   - Local-only PostgreSQL 18 Synthetic Demo已完成分離角色、`001_initial_real_data_schema`與`002_self_hosted_auth`實際migration、ACL finalization、12-table readiness、owner隔離／CAS／cleanup smoke及self-hosted Auth HTTP端到端整合；測試資料已清除。
   - 真實資料Production仍須選定Transactional Email供應商／處理地區／DPA，完成private storage、retention／purge、backup與release security review。Demo仍只使用synthetic資料；不建立SMS／phone流程，不把credential或reset secret送往模型／log。

3. **規則與政策治理**
   - 6條P0 evaluator與regression已實作，但官方規則版本仍為DRAFT，公開Demo前要重查來源。
   - 將警政／消保防詐guidance另建版本化snapshot registry並記錄published／retrieved／verified dates與SHA-256；不得混入`OfficialRule` engine。
   - 三份政策仍有營運者、聯絡方式、處理地區、未成年人與爭議條款placeholder，需台灣法務／隱私審閱後才可轉成生效政策。

## P1 優化

- 手動新增／確認「口頭承諾」來源。
- 手機拍攝導引、設備清單與逐項取景提示。
- 找目標使用者測試是否理解「矛盾」與「證據不足」。
- 補件歷史、報告版本與可分享的雙方確認頁。
- 影片／抽幀、掃描 OCR、多案件、持久化與 private object storage。
- 完整Production單一入口：guest可使用但無歷史查詢，登入／註冊後才有跨session／裝置history；Demo-safe account Auth／history已驗證，Production guest lifecycle與case transfer仍未完成。
- Demo-safe self-hosted Email驗證／password reset、session sliding／rotation／revocation與account recovery smoke已完成；Production仍需Transactional Email、guest-to-user case transfer、guest purge及完整release IDOR／recovery驗收。SMS／phone延後且初期不提供route。
- 把三份政策的營運者、期限、供應商／地區、未成年人與爭議 placeholders 填妥並完成台灣法務／隱私審閱。
- Necessary-only Cookie inventory／network scan；未來非必要用途採獨立 opt-in、decline 與 withdrawal。
- 額外規則、規則 supersedes／expiry／reviewer／change reason 與來源異動提醒。
- `FRS-002` 至 `FRS-010`、反向搜圖、資格與可疑網域受控查詢。
- 租金脈絡與成本情境，但不輸出合理／不合理結論。
- 真實資料的 authentication、authorization、redaction、retention、deletion 與事件處理。

## 避免做

- 整體風險／安全／信用分數或「可以放心簽約」。
- 在 UI 顯示看似精確的模型信心百分比。
- 聊天型 Agent、自治 swarm 或複雜案件管理。
- 讓 LLM 自由決定三態、規則、priority 或法律措辭。
- 把全部官方規則塞進 Golden Demo。
- Provider 失敗後偷偷切換 fallback 或 cheaper model。
- 在完成真實資料 Security Gate 前接收真實租約、影像或身分資料。
- 為了提高註冊率而阻擋訪客分析、隱藏「繼續使用」，或把未登入誤寫成資料公開。
- 以 Email／SMS 回覆洩漏帳戶是否存在，或把 reset token／OTP／電話寫入 URL、log、OpenAI payload。
- 把隱私告知、使用條款、Cloud Processing 與非必要 Cookie 合成一個預先勾選的同意。
