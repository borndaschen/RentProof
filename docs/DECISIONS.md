# 產品與技術決策紀錄

本檔記錄會影響 scope、資料語意、安全或架構的決策。狀態使用 `accepted`、`proposed`、`superseded`。若更改 accepted 決策，新增一筆取代它，不直接抹除歷史。

## 決策摘要

| ID    | 日期       | 狀態                       | 決策                                                                                      |
| ----- | ---------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| D-001 | 2026-09-01 | accepted                   | MVP 採 TypeScript 模組化單體，不做微服務或自治 Agent swarm                                |
| D-002 | 2026-09-01 | partially superseded D-094 | Evidence graph仍是domain truth；「聊天不是主畫面」已改為對話式projection                  |
| D-003 | 2026-09-01 | accepted                   | 廣告承諾只使用支持、矛盾、證據不足三態，且缺席不構成矛盾                                  |
| D-004 | 2026-09-01 | accepted                   | LLM 負責抽取與語意候選；程式負責分類、規則與金額                                          |
| D-005 | 2026-09-01 | accepted                   | 每個肯定結論必須有 source locator；無定位即降為資料不足                                   |
| D-006 | 2026-09-01 | accepted                   | MVP 不抓取任意廣告網址，只保存 URL metadata 並分析截圖／貼上文字                          |
| D-007 | 2026-09-01 | accepted                   | 報告使用 HTML 列印，不另建 PDF 產生服務                                                   |
| D-008 | 2026-09-01 | accepted                   | 成本分成固定月費、變動公式與一次性費用，不虛構單一完整月總額                              |
| D-009 | 2026-09-01 | accepted                   | 官方規則是人工核對、版本化的 YAML；模型不得自行發布規則                                   |
| D-010 | 2026-09-01 | accepted                   | Demo 只用 synthetic fixture，並保留有標示的預先分析 fallback                              |
| D-011 | 2026-09-01 | superseded by D-090        | 建立新的 GitHub 公開 repository；未選定授權前不加入 LICENSE                               |
| D-012 | 2026-09-01 | accepted                   | Demo 素材獨立放在 RentProof 外的 `RentProof-Demo/`，以環境變數載入                        |
| D-013 | 2026-09-01 | accepted                   | 單人 P0 使用 12 張照片與 6 條啟用規則；影片與其餘規則列 P1                                |
| D-014 | 2026-09-01 | accepted                   | 單人 P0 先用 typed repository＋JSON state；SQLite 僅作可選本機持久層，公開版用 PostgreSQL |
| D-015 | 2026-09-01 | accepted                   | P0 雲端 LLM 固定使用 OpenAI API、官方 TypeScript SDK 與 Responses API                     |
| D-016 | 2026-09-01 | superseded by D-085        | P0 預設模型使用 `gpt-5.6-terra`＋reasoning `medium`                                       |
| D-017 | 2026-09-01 | accepted                   | 安全與隱私是 P0 Gate；未完成真實資料 Gate 前只接受 synthetic data                         |
| D-018 | 2026-09-02 | accepted                   | 新增租屋詐騙風險訊號，但不作詐騙判決、機率或黑名單                                        |
| D-019 | 2026-09-02 | accepted                   | P0 採本機 Node／Next.js 模組化單體、顯式 Stage DAG 與 ports／adapters                     |
| D-020 | 2026-09-02 | accepted                   | UI 採 mobile-first RWD、極簡主義與可讀性優先的寬鬆排版                                    |
| D-021 | 2026-09-02 | accepted                   | 真實資料版採單一入口；訪客可使用，登入／註冊只用於保存與查詢歷史                          |
| D-022 | 2026-09-02 | superseded by D-047/D-050  | 帳戶使用 managed identity，忘記密碼支援已驗證 Email 或已綁定手機 SMS                      |
| D-023 | 2026-09-02 | accepted                   | 隱私政策、使用條款與 Cookie 政策採版本化草案；第一版只使用必要 Cookie                     |
| D-024 | 2026-09-02 | superseded by D-051/D-089  | 登入帳戶 session 採合格活動後延長 7 天的 sliding idle expiry                              |
| D-025 | 2026-09-02 | superseded by D-093        | 開發階段允許 synthetic-only HTTP LAN profile；Production HTTPS 不變                       |
| D-026 | 2026-09-02 | accepted                   | JavaScript／TypeScript 套件管理器使用 pnpm                                                |
| D-027 | 2026-09-02 | accepted                   | Application runtime 使用 Node.js 24 LTS                                                   |
| D-028 | 2026-09-02 | accepted                   | Web framework 使用 Next.js 16 Active LTS＋App Router                                      |
| D-029 | 2026-09-02 | accepted                   | UI 元件使用 shadcn/ui＋Radix Primitives                                                   |
| D-030 | 2026-09-02 | accepted                   | 程式品質使用 ESLint Flat Config，格式化使用 Prettier                                      |
| D-031 | 2026-09-02 | accepted                   | P0文字型PDF解析使用Mozilla PDF.js／`pdfjs-dist`                                           |
| D-032 | 2026-09-02 | accepted                   | P0 JPEG／PNG處理使用Sharp                                                                 |
| D-033 | 2026-09-02 | accepted                   | 圖片採寬鬆限制：25 MiB／50 MP／案件400 MiB／Derivative 3200 px                            |
| D-034 | 2026-09-02 | accepted                   | 契約PDF採平衡限制：15 MiB／30頁／300,000字元                                              |
| D-035 | 2026-09-02 | accepted                   | TypeScript採增強嚴格模式                                                                  |
| D-036 | 2026-09-02 | accepted                   | TypeScript compiler使用6.0穩定線                                                          |
| D-037 | 2026-09-02 | accepted                   | OpenAI採寬鬆案件上限：16 attempts／並行2／500K input／50K output＋reasoning               |
| D-038 | 2026-09-02 | accepted                   | OpenAI Responses明確使用`service_tier: default`                                           |
| D-039 | 2026-09-02 | accepted                   | OpenAI Development Project每月Hard Spend Limit為US$100                                    |
| D-040 | 2026-09-02 | accepted                   | OpenAI Development Project Rate Limit採30 RPM／500K TPM／40 IPM／100 RPD                  |
| D-041 | 2026-09-02 | accepted                   | 前端採Vitest／Testing Library／axe元件測試＋Playwright／axe瀏覽器測試                     |
| D-042 | 2026-09-02 | accepted                   | Code Coverage採依模組分級門檻                                                             |
| D-043 | 2026-09-02 | accepted                   | Vitest Coverage Provider使用V8                                                            |
| D-044 | 2026-09-02 | superseded by D-090        | 公開Repository維持沒有開源License                                                         |
| D-045 | 2026-09-02 | superseded by D-046        | 公開預覽使用無HTTPS的`public_http_showcase`靜態Synthetic Demo                             |
| D-046 | 2026-09-02 | accepted                   | P0暫時只在本機／私人LAN展示，不部署公開預覽                                               |
| D-047 | 2026-09-02 | superseded by D-089        | 第一個真實資料版本的Identity Provider使用Clerk                                            |
| D-048 | 2026-09-02 | superseded by D-089        | Clerk重設密碼後立即撤銷Reset Session並要求重新登入                                        |
| D-049 | 2026-09-02 | superseded by D-089        | Clerk在Development與初期Production都使用Hobby方案                                         |
| D-050 | 2026-09-02 | superseded by D-089        | Clerk Hobby初期只提供Email密碼重設，SMS Recovery延後                                      |
| D-051 | 2026-09-02 | superseded by D-089        | 帳戶Session完全使用Clerk Hobby固定7天Lifetime，不建立RentProof Session DB                 |
| D-052 | 2026-09-02 | accepted                   | 真實資料版PostgreSQL adapter使用Kysely＋node-postgres                                     |
| D-053 | 2026-09-02 | accepted                   | PostgreSQL schema migration使用Kysely Migrator                                            |
| D-054 | 2026-09-02 | accepted                   | Production migration採Forward-only＋Expand／Contract                                      |
| D-055 | 2026-09-02 | accepted                   | Guest Session固定24小時，到期後24小時內清除線上案件資料                                   |
| D-056 | 2026-09-02 | superseded by D-057        | 登入帳戶案件自最後有效異動保存24個月，到期前30天通知                                      |
| D-057 | 2026-09-02 | accepted                   | 登入帳戶案件保存至使用者刪除案件或帳戶                                                    |
| D-058 | 2026-09-02 | accepted                   | 帳戶案件刪除後立即停止存取並於7天內完成線上清除                                           |
| D-059 | 2026-09-02 | accepted                   | 加密備份最多保存14天，刪除Tombstone保存21天並於還原前重播                                 |
| D-060 | 2026-09-02 | accepted                   | 最小化Security／Deletion Audit Events保存180天                                            |
| D-061 | 2026-09-02 | accepted                   | Production App與PostgreSQL部署在同一台Server，DB只聽本機介面                              |
| D-062 | 2026-09-02 | accepted                   | Development／Demo使用目前Windows桌面電腦；Production OS暫緩決定                           |
| D-063 | 2026-09-02 | accepted                   | P0 Development／Demo以原生Node.js＋pnpm直接啟動Next.js                                    |
| D-064 | 2026-09-02 | superseded by D-093        | 日常開發使用Next Dev Server；正式Demo使用Production Build＋lan_development安全profile     |
| D-065 | 2026-09-02 | superseded by D-093        | LAN Demo Firewall允許整個Windows Private Network連入指定RentProof IP／Port                |
| D-066 | 2026-09-02 | superseded by D-093        | LAN Demo Firewall Rule保留但預設停用，只在Demo前後獨立切換                                |
| D-067 | 2026-09-02 | accepted                   | Windows P0 Runtime預設使用`%LOCALAPPDATA%\RentProof\runtime`                              |
| D-068 | 2026-09-02 | accepted                   | Development Runtime保留7天；Formal Demo Run結束即清除                                     |
| D-069 | 2026-09-02 | accepted                   | 外部Demo資料夾預設使用`%USERPROFILE%\RentProof-Demo`                                      |
| D-070 | 2026-09-02 | accepted                   | Demo使用不可變版本資料夾、Manifest檔案Hash與分離Truth／Fallback                           |
| D-071 | 2026-09-02 | accepted                   | Demo Manifest使用Strict JSON＋Zod／JSON Schema與Raw-byte SHA-256 Seal                     |
| D-072 | 2026-09-02 | accepted                   | Golden Version必須由`RENTPROOF_DEMO_CASE_VERSION`顯式指定                                 |
| D-073 | 2026-09-02 | accepted                   | Windows Development OpenAI Key保存於repo-root `.env.local`且Server-only                   |
| D-074 | 2026-09-02 | accepted                   | RentProof採對話為主、四區證據工作區為輔的操作架構                                         |
| D-075 | 2026-09-02 | accepted                   | Conversation以自由文字為主要輸入，Material Candidate仍須確認                              |
| D-076 | 2026-09-02 | accepted                   | LAN全面開放Free Text，以無工具Structured Candidate＋Server Policy防Prompt Injection       |
| D-077 | 2026-09-02 | accepted                   | Conversation單則輸入上限2,000 Unicode Code Points且8 KiB UTF-8                            |
| D-078 | 2026-09-02 | accepted                   | Conversation每Actor每分鐘10則、Burst 3、每Case同時1則                                     |
| D-079 | 2026-09-02 | accepted                   | Assistant單次敘述最多600 Code Points且最多3張Cards                                        |
| D-080 | 2026-09-02 | accepted                   | Material Candidate Confirmation有效10分鐘、單次且Revision-bound                           |
| D-081 | 2026-09-02 | accepted                   | Model Context只含目前Turn、Server Structured State與Validated Focus Refs                  |
| D-082 | 2026-09-02 | accepted                   | LAN疑似一般PII警告後可送出；Auth Secrets維持Hard Block                                    |
| D-083 | 2026-09-02 | accepted                   | Raw Conversation Text保存7天後清除，Typed Case Events保留                                 |
| D-084 | 2026-09-02 | accepted                   | Assistant採Server Safety Templates＋LLM Read-only Explanation的Hybrid模式                 |
| D-085 | 2026-09-02 | accepted                   | Conversation使用Luna／low；Evidence Extraction使用Terra／medium                           |
| D-086 | 2026-09-02 | superseded by D-087        | Conversation每Case／24h使用100 Calls／250K Input／50K Output＋Reasoning Budget            |
| D-087 | 2026-09-02 | accepted                   | Conversation每Case／24h使用200 Calls／500K Input／100K Output＋Reasoning Budget           |
| D-089 | 2026-09-03 | accepted                   | 捨棄Clerk，改採PostgreSQL自建Email／密碼Auth與合格活動後延長的7天Sliding Session          |
| D-090 | 2026-09-03 | accepted                   | RentProof repository改採Apache License 2.0並附NOTICE                                      |
| D-091 | 2026-09-03 | accepted                   | 「凶宅」需求只實作為專有部分非自然死亡揭露核對，不輸出物件判決                            |
| D-092 | 2026-09-03 | accepted                   | P1啟用RP-001／002／005／007，P0 profile與Golden結果維持不變                               |
| D-093 | 2026-09-03 | accepted                   | 退役HTTP LAN；本機HTTP只限loopback，LAN改用HTTPS secure demo                              |
| D-094 | 2026-09-03 | accepted                   | 未登入可直接使用；訪客案件綁單一24小時Session並採對話式主流程                             |
| D-088 | 2026-09-02 | accepted                   | Development Luna Project限制30 RPM／500K TPM／300 RPD（若支援）                           |

## 詳細理由與影響

### D-093：退役HTTP LAN，改用HTTPS區域網路展示

**理由：** 使用者需要從LAN裝置操作私有租屋素材與帳戶流程。HTTP無法保護租約、照片、密碼及Session在網路傳輸時的機密性與完整性，因此不再保留HTTP LAN例外。

**影響：** `local_development`是唯一HTTP profile，固定綁定`127.0.0.1`。舊`lan_development`、`dev:lan`、`start:lan`、`.env.lan.local`與`demo:check -- --profile=lan`退役並須fail closed。LAN只使用`lan_secure_demo`：明確RFC1918 IP、HTTPS、受信任憑證、exact Host／Origin、Private-profile Firewall、Secure Cookie、self-hosted Auth、loopback PostgreSQL、private storage與owner-scoped authorization。Fixture／Live仍由startup-only設定決定；Live另要求Server-only key與已確認的OpenAI Project限制。D-025、D-064、D-065、D-066中關於HTTP LAN的現行效力由本決策取代；歷史紀錄保留。

### D-094：訪客免登入與對話式私有案件流程

**理由：** 登入只應用於保存與跨裝置查詢，不應阻擋租屋者先整理資料；同時必須避免可猜案件ID或共用guest identity造成跨工作階段存取。

**影響：** HTTPS首頁會先建立32-byte opaque訪客Cookie，PostgreSQL只保存server-keyed HMAC digest；訪客Session自建立起固定24小時且不滑動。訪客案件的`owner_subject_id`綁定單一`guestSessionId`，不同瀏覽器或同identity的另一Session不能繼承權限；帳戶案件仍綁內部`userId`並使用7天滑動Session。訪客與帳戶共用相同real-case routes及對話式主流程，依序建立案件、加入廣告／看屋照片／租約、分析與查看行動。訪客不可列出歷史；訪客刪除與到期purge期限為24小時，帳戶案件刪除purge期限為7日。Guest-to-user轉移尚未實作，不得以登入後自動保存暗示已完成轉移。

### D-001：模組化單體與固定管線

**理由：** MVP 最大的風險在跨模態資料、可追溯性與判定安全，不在分散式協調。單體能共用 schema、transaction 與測試 fixture。

**影響：** Listing／Viewing／Evidence／Contract 是 stage module，由一個 orchestrator 管理；未來有量能與隔離需求時才抽出 worker。

### D-002：Evidence graph 優先

**理由：** 使用者要回答的是「某項承諾有哪些證據」，不是延續一段對話。Claim、artifact、locator、clause、rule 與 finding 的關係需要可查詢、可重跑。

**影響：** Evidence graph仍是source of truth。原先「聊天式UI不是主畫面」已由D-094取代；現行對話是案件projection，任何生成說明仍不能取代graph或直接修改domain state。

### D-003：保守三態

**理由：** 看屋影片不可能涵蓋整間房，將「沒看到」當作不存在會製造危險的假矛盾。

**影響：** 只有明確相反值或否定文字才是 `contradicted`；未拍到、未列附件、模糊或低信心都是 `insufficient_evidence`。

### D-004：模型與規則分工

**理由：** LLM 適合非結構化抽取、影像描述與契約語意候選，但不應單獨決定金額或規則結果。

**影響：** 所有模型輸出通過 schema／Zod；normalizer、truth table、allowlisted rule evaluators 與報告 reason code 由程式執行。

### D-005：Locator 是必要資料

**理由：** 無法回到廣告區塊、頁碼、照片或時間碼的結論，不具備 RentProof 所承諾的證據價值。

**影響：** locator validation 是 domain gate；失敗時 stage 顯示資料不足或抽取錯誤。

### D-006：不做任意網址抓取

**理由：** 登入、反爬蟲、網站條款、動態頁面與 SSRF 會擴大 MVP 範圍與安全風險。

**影響：** UI 仍可保存來源 URL，但要求使用者提供截圖或貼上文字；未來另做受控 connector。

### D-007：HTML 列印

**理由：** 瀏覽器列印已足以產生雙方確認表，另做 PDF service 不增加核心證據價值。

**影響：** 以 print CSS 和列印 E2E 確保版面；正式產品再評估不可變 report snapshot／PDF。

### D-008：成本不假裝精確

**理由：** 電費依實際度數而變動；把未知用量硬算進月總額會造成另一種資訊不對稱。

**影響：** UI 固定分區，只有取得使用量或使用者輸入情境時才算變動費用。

### D-009：人工治理規則庫

**理由：** 官方版本、適用日期與條文語意需要有人負責；即時模型整理不能直接成為產品規則。

**影響：** 每條規則有 ID、來源、locator、effective／verified date、必要輸入、allowlisted `evaluator_id`、reason codes 與中立模板；YAML 判斷文字不得執行，更新需 regression。

### D-010：Synthetic demo 與 fallback

**理由：** 公開 repository 不能含真實租約／屋況個資；現場 demo 也不該因網路波動失敗。

**影響：** fixture 真值由人定義；fallback 明確顯示其建立時間與版本，不能假裝即時分析。

### D-011：公開 repository 暫不附授權

> 狀態：已由D-090取代；下列內容只保留歷史脈絡。

**理由：** 使用者已明確要求公開 repository，但尚未指定 MIT、Apache-2.0 或其他授權。公開可見不等同授予再利用權利。

**影響：** 初始 repo 不建立 LICENSE；確定授權後另記決策並加入檔案。

### D-012：Demo 素材獨立於 repository

**理由：** Demo 影像、PDF 與預期輸出不是程式碼，且即使完全虛構，也應能獨立管理體積、授權與是否公開。

**影響：** 本機使用與 RentProof 同層的 `RentProof-Demo/`；App 只透過 `RENTPROOF_DEMO_DIR` 讀取。Repository 缺少外部資料時明確報錯或 skip，不複製素材回專案。

### D-013：單人 P0 瘦身

**理由：** 原三角色並行範圍不適合單人循序完成，會讓核心證據流程與品質 Gate 被非必要基礎設施稀釋。

**影響：** P0 固定一個 Golden case、12 張照片、清楚文字 PDF，以及 `RP-003`、`RP-004`、`RP-006`、`RP-008`、`RP-009`、`RP-010` 六條規則。影片、掃描 OCR、額外四條規則與多案件列 P1；依品質 Gate 決定何時進入下一階段，不設定工時。

### D-014：P0 不導入資料庫

**理由：** Golden case 的價值在 schema、三態與 locator；ORM、migration 與多案件持久化不是 90 秒 Demo 的必要證據。

**影響：** domain 透過 typed repository interface 使用記憶體／外部 JSON state；需要本機持久化時可加 SQLite／Drizzle adapter，公開部署則使用 PostgreSQL，避免把本機與 public topology 混為一談。

### D-015：OpenAI Cloud LLM

**理由：** 使用者已指定 OpenAI Cloud。Responses API 能處理 RentProof 所需的文字、影像與結構化輸出，單一官方 SDK 也能縮小供應商整合面。

**影響：** P0 只實作 `OpenAIResponsesGateway` 與離線 `FixtureModelGateway`，不做本機 LLM 或第二家雲端 provider。Viewing checklist、三態、官方規則、priority 與報告仍由本機程式處理。

### D-016：`gpt-5.6-terra` 作性價比預設

**理由：** OpenAI 官方將 Terra 定位為智慧與成本的平衡，且支援 image input、Responses API 與 Structured Outputs。RentProof 涉及契約語意與過度結論風險，不能只按最低單價選模型。

**影響：** P0 使用 `gpt-5.6-terra`＋`medium`；model／effort 進 allowlist、StageRun、AnalysisSnapshot、cache key 與 fallback provenance。`gpt-5.6-luna` 只有在相同 Golden／安全 eval 不降低品質時，才可用於較單純 stage；不自動降級。

### D-017：Security Gate

**理由：** 租屋影像、契約與 API key 都是高敏感資產；模型錯誤也可能造成錯誤法律／責任暗示。

**影響：** P0 必須通過 `docs/SECURITY_PRIVACY.md` 的 key、upload、path、prompt injection、OpenAI failure、log redaction、HTML escaping、fallback provenance 與 synthetic-only Gate。Guest／user sessions、owner authorization、private object storage、政策／告知與刪除流程完成前，不接受真實資料。

### D-018：詐騙風險訊號，不是詐騙判決

**理由：** 台灣政府防詐指引可提供付款前風險訊號與查證行動，但單靠廣告、聊天、照片與契約不足以判斷個案是否成立詐騙；直接標籤也有誤判、誹謗與安全風險。

**影響：** P0 新增 synthetic interaction／payment timeline、`FraudSignalCheck` 與一個 `FRS-001` typed evaluator（首次實地看屋前要求付款）。其他訊號列 P1。OpenAI 只抽取候選事實＋locator，本機規則輸出 `detected`／資料不足與 `stop_and_verify`。禁止詐騙 verdict、機率、整體分數、黑名單、自動報警或付款阻擋。

### D-019：P0 系統架構基線

**理由：** P0 需要 filesystem、PDF 與 server-only OpenAI SDK，但單人開發不需要微服務、serverless、queue 或資料庫。顯式 DAG 與 ports／adapters 可保留局部重跑、測試隔離及未來替換能力。

**影響：** P0 使用 loopback-only Next.js Node process、分層模組化單體、JSON `CaseStateRepository`、private filesystem `ArtifactStore`、OpenAI／Fixture gateways 與 allowlisted TypeScript evaluators。Domain／application 不直接依賴 Next.js、OpenAI SDK 或 filesystem。P1 可替換為 PostgreSQL、private object storage 與 queue／worker，但保留 domain schemas、reason codes 與 stage DAG。完整規格見 `docs/SYSTEM_ARCHITECTURE.md`。

### D-020：RWD 極簡 UI 與清晰排版

**理由：** RentProof 呈現大量來源、條款與行動；若把 Desktop table 壓縮到 Mobile，或用小字／密集卡片堆疊，會降低證據理解與安全性。

**影響：** P0 使用 mobile-first 四 tab、Desktop table／split view 與 Mobile card／dialog 的等價呈現。視覺採白底、單一 accent、低陰影、充足留白；正文／表格至少 16 px、caption 至少 14 px，中文行高 1.6–1.7。不以縮字、ellipsis、重型圖表、風險分數或不必要動畫解決資訊密度。完整規格見 `docs/UI_DESIGN.md`。

### D-021：單一入口與選用帳戶

**理由：** 使用者希望不註冊也能先完成租屋證據比對，帳戶的主要價值是保存與跨 session／裝置查詢，不應成為分析入口門檻。

**影響：** Production 的 `/`／`/app/new` 同時服務 guest 與 authenticated user。Guest 使用短期 server-side session 與私有 owner-scoped case，可完成分析、補件及下載報告，但不能列出／搜尋歷史；UI 在建立前與上傳區明確提醒 session／Cookie 遺失或換裝置後可能無法找回。登入／註冊是可選動作；guest 在 session 有效且已登入時可明確將目前 case 原子轉移到自己的帳戶。P0 synthetic Demo 不增加帳戶功能。

### D-022：Managed identity 與 Email／SMS 密碼重設

**理由：** 密碼、重設 token 與 SMS OTP 是高風險認證資料，單人產品不應自行設計密碼儲存或恢復機制；同時使用者需要忘記密碼的可恢復路徑。

**影響：** Provider 透過 `AuthProvider` port 隔離，Email 為主要帳戶識別；SMS 只對已綁定、已驗證電話開放。兩個 recovery 管道皆使用 generic response、短效單次 challenge、attempt／resend limit 與 rate limit；成功後不自動登入並撤銷舊 sessions。電話加密／遮蔽、token／OTP 不進 log 或 OpenAI。實際 identity／SMS provider 仍需依安全、資料區域、成本與 lock-in 選型。

### D-023：版本化政策與 necessary-only Cookie

**理由：** RentProof 會處理租約與影像並使用 OpenAI Cloud，不能只在頁尾放一段模糊告知，也不能把不同法律／產品事件合成一個 checkbox。

**影響：** 新增 `PRIVACY_POLICY_DRAFT.md`、`TERMS_OF_USE_DRAFT.md`、`COOKIE_POLICY_DRAFT.md`。`PolicyDocument` 與 append-only events 分開記錄 Terms acceptance、Privacy acknowledgement 與 Cloud Processing choice；Cookie 以 purpose-scoped preference 記錄 granted／declined／withdrawn。第一版不啟用 analytics／marketing Cookie。三份文件填妥營運者、保存期限、供應商／地區、未成年人與爭議資訊並完成台灣法務／隱私審閱前，只能標示為草案且不得接受真實資料。

### D-024：7 天滑動式帳戶 session

**理由：** 使用者希望登入狀態可維持 7 天，持續使用時自動延長，同時避免背景流量或攻擊者用無意義 request 永久續期。

**影響：** 每次成功驗證且由使用者主動觸發的合格 request，將 account session 的 idle expiry 更新到活動後 7 天。Static asset、prefetch、health check、background polling／heartbeat、分析進度自動輪詢、failed auth、CSRF 或 rate-limit 拒絕不延長。Logout、password reset 與 security revoke 立即失效；高敏感操作可要求 step-up authentication。Guest session 不套用 7 天，absolute reauthentication window 待 threat review 決定。

### D-025：HTTP 區域網路開發模式

**理由：** 開發者需要用同一私人 LAN 的手機與其他電腦驗證 RWD；開發階段暫不配置 HTTPS。但 HTTP 無法保護真實租約、帳戶憑證或 session，所以必須與 Production 安全邊界分離。

**影響：** Deployment profiles 收斂為 `local_development`、`lan_development`、`public_showcase`、`production`，LLM Fixture／Live 另由 startup-only mode 決定。`lan_development` 只綁明確 RFC1918 IPv4，使用 exact Host／Origin、Windows Private firewall／來源子網，禁止 wildcard／public bind、port forwarding 與 production auth。只接受外部 Demo manifest 中 `synthetic: true` 且 hash 相符的素材；Fixture 預設，Live 另加成本限制。Production 仍強制 HTTPS、Secure cookies、private storage 與 owner authorization。本決策只取代 D-019 的「loopback-only」部分，其模組化單體、DAG 與 ports／adapters 決策不變。完整契約見 `docs/SERVER_CONFIGURATION.md`。

### D-026：pnpm 套件管理器

**理由：** 使用者選擇 pnpm。它受 Next.js 官方工具支援，具較好的安裝效率、磁碟重用與嚴格依賴邊界，適合 RentProof 的模組化單體與可重現建置。

**影響：** Scaffold 使用 pnpm，`package.json` 的 `packageManager` 欄位鎖定實際版本，repository 只提交 `pnpm-lock.yaml`。不得同時加入 npm、Yarn 或 Bun lockfile；CI 使用 lockfile frozen／immutable 安裝。實際 pnpm 版本與安裝／lint／typecheck／test／E2E 指令等 scaffold 後再補入 `AGENTS.md`，現在不虛構。

### D-027：Node.js 24 LTS

**理由：** 使用者選擇 Node.js 24 LTS。它是目前官方 LTS 系列，適合新的 Next.js 專案，並比舊 LTS major 具有較長的後續維護週期。

**影響：** 開發、CI、LAN development 與 Production runtime 使用 Node 24。Scaffold 時以 `.node-version`、`package.json.engines`、CI image／runtime 或等價設定鎖定當時最新的 `24.x` 安全修正版；不使用 Node Current，也不只寫未鎖定的 `>=24`。Patch 升級需通過 lint、typecheck、unit、Golden E2E 與安全 Gate。

### D-028：Next.js 16 Active LTS

**理由：** 使用者選擇 Next.js 16 Active LTS。它是目前官方 Active LTS 線，適合新的 App Router 專案，並與 Node.js 24 LTS 相容。

**影響：** 使用 Next.js 16 App Router、Node runtime 與 Server Components baseline。Scaffold 時鎖定當時最新的 patched `16.x`，Next／React／React DOM／types 作為相容集合寫入 `pnpm-lock.yaml`；不保留會跨 Major 的 `latest` range。Turbopack採官方穩定預設，但需通過 development、LAN、production build與 Golden tests；不啟用 experimental Cache Components、React Compiler或其他實驗功能，除非另有量測與決策。

### D-029：shadcn/ui＋Radix Primitives

**理由：** 使用者選擇 shadcn/ui＋Radix。它提供適合 Next.js／Tailwind 的可維護元件原始碼，以及 Dialog、Tabs、Accordion 等複雜元件的 accessibility／focus／keyboard 基礎，可降低單人開發風險。

**影響：** 只從官方 shadcn registry 加入 P0 實際需要的元件，生成 source 納入 repository 與 code review，再套用 RentProof 自有 design tokens；不安裝整套 Dashboard、不使用未審查第三方 registries。Radix／shadcn 版本鎖入 pnpm lockfile，CLI overwrite 必須先檢視 diff，更新後重跑 keyboard、focus、screen-reader、RWD與 visual tests。UI 的狀態語意仍由 server view model／RentProof wrappers 決定，不下放給元件庫。

### D-030：ESLint Flat Config＋Prettier

**理由：** 使用者選擇ESLint＋Prettier。ESLint可使用Next.js／TypeScript／React生態的code-quality規則，Prettier專責一致格式，適合RentProof的安全與accessibility Gate。

**影響：** 使用ESLint Flat Config及Next.js官方plugin baseline，Prettier獨立執行；以`eslint-config-prettier`或等價配置關閉衝突stylistic rules，不使用`eslint-plugin-prettier`。Next.js 16 build不自動執行lint，CI／交付必須顯式分開執行lint、format check與typecheck。實際版本與scripts等Scaffold後鎖定並補入AGENTS。

### D-031：Mozilla PDF.js

**理由：** 使用者選擇直接使用Mozilla PDF.js／`pdfjs-dist`。相較額外wrapper，它能逐頁取得文字與position metadata，較適合RentProof的page／excerpt locator及未來sanitized preview。

**影響：** `pdfjs-dist`只存在server-side `PdfTextExtractor` infrastructure adapter，Domain／Application只依賴port。P0只處理本機已驗證的清楚文字型PDF；不讓PDF.js fetch使用者URL，不執行JavaScript、附件、form actions或external links。Parser輸出需通過頁碼／位置／excerpt與資源上限驗證，錯誤使用typed reason code；掃描OCR仍為P1。版本鎖入pnpm lockfile並以Golden契約及對抗PDF回歸。

### D-032：Sharp圖片處理

**理由：** 使用者選擇Sharp。它提供高效JPEG／PNG解碼、方向校正、Resize與重新編碼，預設輸出移除Metadata，並支援Node.js 24與Windows／Linux預編譯Binary。

**影響：** Sharp只存在server-side image ingestion adapter。P0 allowlist維持JPEG／PNG；使用`autoOrient`後在集中資源上限內重新編碼，不呼叫`keepMetadata`／`withMetadata`，不得啟用`unlimited`。輸出需重新驗證format、pixels、bytes、hash與metadata stripping才成為sanitized derivative。版本與platform optional dependencies鎖入pnpm lockfile，Windows development需安裝／Golden fixture測試；Production OS選定後再補該平台驗證。

### D-033：寬鬆圖片上傳限制

**理由：** 使用者選擇寬鬆方案，以直接接受多數高解析度手機照片；相較平衡方案，願意承擔較高的記憶體、處理時間與儲存成本。

**影響：** JPEG／PNG每張最多25 MiB、解碼後最多50,000,000 pixels、每案件原始圖片合計最多400 MiB；sanitized derivative最長邊3200 px且不得放大。每個upload request只收一張圖。Stream在完整buffer前執行byte cap，Sharp設定pixel／channel／format limits，repository原子檢查case quota；超限回typed error，不允許client、query或route自行提高。此決策不放寬LAN synthetic hash allowlist或Production private storage要求。

### D-034：平衡契約PDF限制

**理由：** 使用者選擇平衡方案，以涵蓋一般住宅租約及附件，同時控制PDF.js記憶體、解析時間與惡意PDF攻擊面。

**影響：** P0每份契約PDF最多15 MiB、30頁、抽取文字合計300,000 Unicode characters，每個upload request只收一份。Server依序執行stream byte cap、PDF.js page-count與normalized text-length checks，超限即停止並釋放資源。符合數量限制仍必須通過magic／MIME、加密／active-content、頁碼／excerpt locator與文字品質Gate；掃描OCR仍為P1。限制集中於security config，不接受client override。

### D-035：TypeScript增強嚴格模式

**理由：** 使用者選擇增強嚴格模式。RentProof的unknown／not-present語意、evidence refs、Stage狀態與規則結果需要編譯器協助區分缺值、索引越界與未涵蓋分支。

**影響：** `tsconfig`啟用`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`noImplicitOverride`、`noPropertyAccessFromIndexSignature`、`noUncheckedSideEffectImports`與`noEmit`。外部資料以`unknown`進Zod／adapter validation，不允許用`any`或廣域assertion繞過。第三方type問題以窄wrapper隔離；必要`@ts-expect-error`須附理由與test。TypeScript升級需通過typecheck與完整回歸。

### D-036：TypeScript 6.0穩定線

**理由：** 使用者選擇TypeScript 6.0。它是正式stable compiler並保留完整Compiler API，較適合目前採用的ESLint／typescript-eslint與Next.js工具鏈；TypeScript 7暫時仍需要6.0相容套件支援部分工具。

**影響：** Scaffold鎖定最新`6.0.x`，並鎖定相容的typescript-eslint、React／Node types及Next plugin。`tsconfig`明確設定module resolution、types、paths與全部增強strict flags，不依賴跨版本floating defaults。不使用TypeScript 7、native preview或nightly；未來升級須先通過tooling compatibility、typecheck、unit、Golden E2E與安全Gate。

### D-037：OpenAI寬鬆案件預算

**理由：** 使用者選擇寬鬆方案，希望保留Evidence拆批、補件與錯誤重試彈性，接受較高的單案成本與LAN濫用風險。

**影響：** 每案件最多16次provider attempts（包含SDK實際重試）、同時最多2個requests、累計500,000 input tokens、50,000 output＋reasoning tokens。依OpenAI Docs在2026-09-02列出的Terra標準價格，應用設定US$2／案件工程警戒；它不是帳單保證。送出前原子reserve budget，完成後依usage reconcile；usage unknown不得填0。超限停止新Stage並顯示typed budget error，不自動降模型或切Fixture。另使用OpenAI Project rate／hard-spend controls，實際月額待決定。

### D-038：OpenAI Default Service Tier

**理由：** 使用者選擇`default`，以固定標準價格／效能、避免Project設定變更造成同一程式靜默改用不同處理層級，提升Golden eval與fallback provenance可重現性。

**影響：** 每次Responses request明確送`service_tier: "default"`，allowlist不接受`auto`、`flex`、`priority`或其他tier。Requested與response resolved tier記入StageRun、AnalysisSnapshot、cache config hash與fallback provenance；不符時視為provider／configuration anomaly，不當成功cache。改變tier需新決策、成本核對及完整Golden／安全eval。

### D-039：Development Project每月US$100 Hard Limit

**理由：** 使用者選擇每月US$100，以提供約50個達US$2單案警戒值的最大開發空間，接受設定錯誤時較高的潛在損失。

**影響：** RentProof Development OpenAI Project設定US$100 monthly Hard Spend Limit，並在US$50及US$80建立Spend Alerts。管理設定不由Application runtime修改，Runtime／CI不持有Admin API Key，只使用scoped Development service key。Live readiness checklist需核對limit／alerts；Project hard limit或provider budget error轉為typed failure，不切Fixture。Production建立獨立Project、key與額度，不沿用本決策。

### D-040：Development Project平衡Rate Limit

**理由：** 使用者選擇平衡方案，在單人開發與12張照片拆批可用的前提下，限制短時間Bug、LAN重複操作或濫用快速消耗US$100月額。

**影響：** Development Project對`gpt-5.6-terra`設定30 requests/minute、500,000 tokens/minute、40 images/minute與100 requests/day；image／day欄位只有在該Project／model支援時配置。Application仍保留concurrency 2、每案件16 attempts與500K／50K token caps。若OpenAI帳戶Usage Tier上限較低，採較低值並顯示configuration status，不以新增Project、換Key或密集重試規避。Runtime不持有Admin Key，設定由部署checklist核對。

### D-041：完整前端與Accessibility測試層

**理由：** 使用者選擇完整方案。RentProof使用大量Dialog、Tabs、Accordion、status與evidence interactions，只靠E2E會讓錯誤定位慢，只靠jsdom又無法涵蓋真實layout與contrast。

**影響：** Component tests使用Vitest＋jsdom＋React Testing Library＋user-event＋jest-dom與axe整合；Browser tests使用Playwright＋axe。查詢優先role／label／visible text，避免implementation-detail snapshots。jsdom axe不涵蓋真實color contrast／layout等規則，因此仍要求Playwright、人工keyboard、200% zoom與screen-reader smoke。實際axe adapter package在Scaffold時依維護狀態鎖定，版本全部進pnpm lockfile。

### D-042：依模組分級Coverage

**理由：** 使用者選擇分級方案。RentProof核心判定與安全規則比UI樣式／adapter樣板風險高，單一全域百分比可能讓低價值測試掩蓋Domain branches缺口。

**影響：** 核心Domain／normalizer／official-rule／fraud／report-priority要求95% lines／functions／statements及100% branches；Application／orchestrator 90%全指標；Infrastructure adapters與UI 80% lines／functions／statements、75% branches；全域最低85% lines／statements、80% functions／branches。Vitest以glob thresholds enforcement，autoUpdate關閉。Type-only、官方snapshots、config與未修改shadcn generated source可排除統計，但RentProof wrappers必須納入。新增exclude／ignore需Review與理由，Coverage不取代Golden／E2E／security tests。

### D-043：V8 Coverage Provider

**理由：** 使用者選擇V8。RentProof固定Node.js 24／Vitest環境，V8 Provider可避免pre-instrumentation並提供較快、較低記憶體的coverage；Vitest AST remapping用於維持source report準確度。

**影響：** 使用`@vitest/coverage-v8`，與Vitest版本一致鎖入pnpm lockfile。不混用Istanbul provider／ignore comments；Coverage config明確include／exclude／glob thresholds及autoUpdate false。Windows development與CI Node.js 24需產生一致threshold結果；若未來測試Runtime改為非V8，需新決策而不能靜默換Provider。

### D-044：維持沒有License

> 狀態：已由D-090取代；下列內容只保留歷史脈絡。

**理由：** 使用者選擇不授予一般性的使用、修改或散布權限，延續D-011在尚未決定開源治理時不加入LICENSE的方向。

**影響：** Repository可公開瀏覽，但README／網站不得宣稱Open Source，不新增專案LICENSE。Scaffold後`package.json`設`private: true`防止誤發布。第三方套件、shadcn／Radix generated source與官方來源內容仍受各自License／Notice約束，需產生第三方授權清單；不得把它們誤標為RentProof自有。未建立Contributor terms／授權前不合併外部程式碼貢獻。未來若改授權，新增決策而不回溯改寫本紀錄。

### D-045：Public HTTP Static Showcase

**理由：** 使用者選擇建立公開唯讀Synthetic Showcase，但明確不要HTTPS。HTTP無法驗證伺服器身分或防止傳輸內容被讀取／竄改，因此只能接受完全靜態、無敏感能力的展示範圍。

**影響：** 新profile命名`public_http_showcase`，取代現行規格中的`public_showcase`。Build time從verified Golden fallback產生static export，部署沒有Node runtime、API／Server Actions、upload、OpenAI key、identity、Cookie、form、browser storage、service worker、source map或third-party script。所有頁面持續警告Public HTTP、integrity not guaranteed、synthetic-only、不可作正式證據，並設noindex／nofollow。HTTP例外只適用這個Showcase；Production仍強制HTTPS、Secure cookies、private storage與owner authorization。本決策取代D-025中Public Showcase使用HTTPS的部分，不改LAN或Production規則。

### D-046：暫時只在本機／LAN展示

**理由：** 使用者選擇暫時只在LAN展示，不承擔公網HTTP內容竄改、Hosting維護、VPS費用或開發電腦Port Forwarding風險。

**影響：** P0只啟用`local_development`與`lan_development`，不建立VPS、Public DNS、Router Port Forwarding、Public Firewall Rule或`public_http_showcase`Build／部署。展示方式為同LAN裝置、備用錄影或操作者現場環境。D-045被本決策取代，但其static安全規格保留作未來參考；重新啟用公網預覽必須新增決策並重跑Showcase Gate。Production HTTPS規則不變。

### D-047：Clerk Identity Provider

**理由：** 使用者選擇Clerk，優先考量Next.js App Router整合速度、Email／Phone identifier、Email／SMS reset code及現成帳戶UI／Session管理。

**影響：** 第一個真實資料版本使用Clerk，SDK只存在`ClerkAuthProvider`／`ClerkActorSessionAdapter` infrastructure adapters。Clerk user／session IDs映射RentProof internal IDs；每個case query仍由Server `auth()`後執行owner-scoped repository authorization，Client`Show`／prebuilt UI不構成授權。Clerk keys、webhook secrets、tokens、OTP不進Client／OpenAI／logs。Clerk reset完成會建立登入session，與RentProof既有「不自動登入」規則衝突，下一決策需選擇立即revoke／sign-out或修改規則。Plan、data region、DPA、SMS費率與7天session customization仍是Release Gate。

### D-048：Password Reset後立即撤銷並重新登入

**理由：** 使用者選擇保留RentProof既有安全規則，不接受Clerk reset成功後的預設auto-login。密碼重設管道被控制時，不應直接取得既有租約與案件存取權。

**影響：** 使用Clerk custom forgot-password flow；Reset task／session永遠不轉成RentProof user `ActorContext`。驗證碼與新密碼成功後撤銷其他sessions，再由Backend revoke／sign-out當前reset-created session、清Cookie並redirect一般登入。只有新的一般登入流程才能建立owner-scoped actor。撤銷失敗fail closed且不顯示case；需測完成／revoke race、重放、舊session、current session與重新登入。Clerk prebuilt auto-login元件不能直接用於此流程。

### D-049：Clerk Hobby用於Development與初期Production

**理由：** 使用者選擇零固定月費方案，接受Clerk Hobby的功能限制，以延後Pro訂閱成本。

**影響：** Development與初期Production都使用Clerk Hobby，依2026-09-02官方方案為50,000 MRU、固定7天Session與1-day Application Logs。不得依賴Pro-only MFA、Production SMS Authentication、Custom Session Lifetime、去品牌或較長Logs。這與既有Email／SMS recovery及7天sliding idle需求衝突；在後續決策解決前，真實資料Production Gate維持關閉。程式需capability check，避免Development可試用Pro功能卻在Hobby Production失效。

### D-050：初期只使用Email Password Reset

**理由：** 使用者選擇維持Clerk Hobby零固定費用，不外接SMS Provider，也不升級Pro；接受第一個真實版本沒有SMS Recovery。

**影響：** 初期帳戶只使用Email identifier／verification／password reset，不蒐集phone、不顯示SMS UI、不配置SMS Provider。Forgot-password response保持generic，Clerk reset code短效／單次／限速；完成後依D-048撤銷reset與其他sessions，再要求重新登入。D-050取代D-022的SMS部分。未來啟用SMS需升級Clerk或新增受託者、更新Privacy／Terms、安全測試及新決策，不能只打開Dashboard功能。

### D-051：完全使用Clerk Hobby固定7天Session

**理由：** 使用者選擇不建立RentProof自有Session資料庫／Token，優先降低自建Session、Cookie、Rotation、CSRF與Clerk同步複雜度；接受放棄先前Sliding Session需求。

**影響：** Account session完全由Clerk Hobby管理固定7天Lifetime，D-051取代D-024。RentProof PostgreSQL只保存Internal User、`clerk_user_id`mapping、Case Owner、Policy／Consent、Deletion與Security Audit，不建`auth_sessions`、不存password hash、Clerk token hash、原始Cookie或Reset Code。每個request以Clerk server auth解析session後再查owner-scoped repository；Client state不構成授權。Logout、reset、revoke或7天到期後立即拒絕。Guest session仍是獨立短期模型。若未來需要Sliding，必須升級Clerk或新增自有Session架構與決策。

### D-052：Kysely＋node-postgres作為PostgreSQL adapter

**理由：** 使用者選擇型別安全且貼近SQL的輕量方案。Kysely適合在增強嚴格TypeScript下表達owner-scoped query與transaction；node-postgres提供PostgreSQL connection pool與parameterized query底層。相較完整ORM，此組合較符合RentProof ports／adapters及明確資料授權邊界。

**影響：** P0仍使用記憶體／JSON state，不安裝或啟動PostgreSQL。First real-data release才在infrastructure建立Kysely／node-postgres adapter；Domain／Application只依賴typed repository ports，不得import Kysely或`pg`。每個case／artifact／run／snapshot／report query必須含owner scope，transaction使用同一database connection，pool、statement timeout、TLS、credential rotation與migration策略仍需在Production scaffold前決定。SQLite／Drizzle不再是預設本機持久化路線；若未來需要，須另作adapter與決策。

### D-053：Kysely Migrator管理PostgreSQL schema

**理由：** 使用者選擇沿用Kysely內建Migrator，避免單人專案再維護另一套migration DSL或外部binary。Kysely Migrator提供有序migration、資料庫層級鎖與`up`／`down`介面，能和既定node-postgres adapter共用受控連線設定。

**影響：** First real-data release將versioned TypeScript migration放在獨立database infrastructure目錄，使用固定、不可回頭修改的migration檔案與明確migration table。Migration不得依賴當前Domain型別、Application service或執行使用者／租約內容；執行前後驗證狀態並將結果寫入deployment audit，不在一般Web request啟動時自動migrate。P0不安裝或執行Migrator。Production rollback／expand-contract政策仍需下一項決定。

### D-054：Production Forward-only＋Expand／Contract

**理由：** 使用者選擇以資料完整性優先，不把可能刪欄位、逆轉資料轉換或遺失新寫入的`down`當成正式環境快速回滾。租約、證據與權限資料需要可驗證、可逐步部署的相容變更。

**影響：** Production schema只向前套用新migration。變更先Expand：新增nullable欄位／新表／相容索引；再部署可同時處理舊新schema的程式與必要的可重入backfill；驗證讀寫、owner scope與資料量後，於另一個部署Contract移除舊結構。故障時優先回退仍與expanded schema相容的Application，資料庫問題以新forward-fix migration處理。`down`只允許local／ephemeral test database；Production不得直接執行。破壞性Contract前仍需已驗證backup／PITR與明確人工核准，整庫還原只作incident最後手段而非常規rollback。

### D-055：Guest 24小時Session與24小時Purge SLA

**理由：** 使用者選擇在不強制登入的便利性與租約／影像資料最小保存之間採短期方案。一天足以完成一般分析、下載報告或選擇登入保存，同時避免無帳戶案件長期留存。

**影響：** Production Guest Session自建立起固定24小時到期，不滑動延長；Cookie不得晚於server expiry。到期後立即拒絕case／artifact／report存取並停止未完成工作，quarantine、原檔、derivative、cache、runs、snapshots、reports與適用的第三方file objects須在24小時內完成線上purge，因此未轉移案件自建立起最長約48小時離開線上系統。有效期內刪除也立即撤銷存取並進入相同24小時purge SLA。登入／註冊不會自動保留案件，只有使用者明確執行原子guest-to-user transfer才改採帳戶案件政策。Backup輪替、tombstone與必要security audit另行決定並須在Privacy Notice揭露。

### D-056：帳戶案件保存24個月與30天通知

**理由：** 使用者選擇讓一般一年期租約在租期後仍保有一段查詢空間，同時避免租約、影像與分析結果無限期保存。到期提醒讓使用者能在清除前下載、刪除或明確延長。

**影響：** User-owned case自最後一次合格有效異動起保存24個月；到期前30天寄送不含地址、租約內容或敏感摘要的必要服務通知。合格異動限使用者建立案件、上傳／修改證據、明確觸發並完成分析、補件或按下延長保存；清單／案件瀏覽、下載、static／prefetch／polling、系統重試、規則更新或背景重新處理不得延長。Guest-to-user原子轉移以轉移完成時間建立第一個user retention anchor。使用者可隨時手動刪除；到期或刪除時立即從一般查詢隱藏並進入purge workflow。線上purge SLA、backup與audit retention另行決定。

### D-057：帳戶案件保存至使用者刪除

**理由：** 使用者將上一選擇改為選項3，優先保留跨租期、跨裝置的完整歷史查詢，不採24個月自動到期或到期前通知。

**影響：** D-057取代D-056。User-owned case在帳戶有效期間保存，直到使用者明確刪除該案件或刪除帳戶；不因閒置自動清除，也不建立24個月retention anchor、30天到期通知或延長保存按鈕。History與case detail必須提供清楚的刪除控制及刪除範圍說明；刪除確認後立即從一般查詢隱藏並進入purge workflow，帳戶刪除需涵蓋全部owned cases。線上purge SLA、backup／tombstone、必要security／legal retention與服務終止處理仍須另行決定並在Privacy／Terms揭露。此方案增加敏感資料長期保存與儲存成本，Production需以加密、owner authorization、最小權限、刪除E2E與定期retention review降低風險。

### D-058：帳戶案件7天線上Purge SLA

**理由：** 使用者選擇在刪除可預期性與物件儲存、cache、queue及第三方清除失敗重試之間保留最多7天維運空間。

**影響：** 使用者確認刪除帳戶案件或帳戶後，相關案件立即從history、case API、artifact與report routes停止一般存取，且不可在7天窗口內由使用者恢復。PostgreSQL案件內容、quarantine、原檔、derivative、cache、runs、snapshots、reports、搜尋／索引資料與適用第三方file objects須由冪等purge workflow在7個日曆日內完成清除。每個target記錄不含內容的狀態／attempt／完成時間，失敗自動重試；接近或超過SLA必須告警，未完成不得顯示「已完全刪除」。Guest仍依D-055使用24小時線上purge SLA。Backup副本、最小必要deletion tombstone與security／legal audit另行決定並須明確揭露。

### D-059：備份14天與Deletion Tombstone 21天

**理由：** 使用者選擇以兩週災難復原窗口平衡歷史租約可恢復性、敏感資料暴露期間與儲存成本，並以較長的最小化tombstone避免還原舊備份時讓已刪資料復活。

**影響：** PostgreSQL backup、object storage backup及適用的PITR／transaction logs自各自建立時間起最多保存14個日曆日，必須加密、最小權限且只用於災難復原，不得供一般查詢、客服找回或分析。Deletion tombstone自刪除請求起保存21個日曆日，只含重播所需的opaque case／artifact references、deletion event、target與時間，不含租約、地址、檔名、報告或影像內容。任何restore先進隔離環境，於開放流量前重播仍有效tombstones、清除對應資料並驗證owner／deletion invariants；驗證失敗不得上線。線上purge完成與backup自然到期需分開向使用者說明。Provider不支援14天上限、加密、isolated restore或tombstone replay時，Production Gate保持關閉。

### D-060：Security／Deletion Audit保存180天

**理由：** 使用者選擇保留足以調查延遲發現的帳戶入侵、IDOR、管理操作與刪除失敗的窗口，同時不讓稽核metadata無限累積。

**影響：** Allowlisted Security／Deletion Audit Event自事件發生起最多保存180個日曆日，到期後24小時內purge。欄位限event type、occurred／recorded time、success／failure、reason code、request／correlation ID、pseudonymous internal actor／target reference、provider reference及最小必要attempt／completion metadata；不得包含租約／廣告／報告文字、圖片、地址、檔名、email／phone、完整request body、prompt／model output、Cookie、Authorization、password、reset token或OTP。Audit storage加密、append-oriented、最小權限且不可供產品分析／廣告。Deletion audit不能用來重建案件；21天deletion tombstone仍是獨立restore control。若法務要求不同期限，需新決策與Privacy更新，不能靜默延長。

### D-061：Production App與PostgreSQL同機部署

**理由：** 使用者選擇把Next.js App與PostgreSQL放在同一台Production Server，以降低初期主機成本與網路拓撲複雜度，並接受App與DB共享故障域及自行維運PostgreSQL的責任。

**影響：** P0仍為本機／LAN＋JSON；只有first real-data Production使用同機PostgreSQL。DB listener只綁`127.0.0.1`／`::1`或等價local socket，OS firewall拒絕LAN／Internet連入PostgreSQL port，不建立public DB endpoint。App runtime、migration、backup分離least-privilege DB roles；PostgreSQL使用獨立OS service account／data directory權限，設定connection／memory／disk limits與磁碟空間告警。此拓撲沒有DB HA，Host故障會同時中斷App與DB；加密backup／PITR必須送到不同故障域的off-host private storage且維持D-059的14天上限。Production仍必須HTTPS，HTTP `lan_development`不得連production DB或啟用真實auth／uploads。Server OS、process isolation、off-host backup provider與RPO／RTO仍待決定。

### D-062：Windows桌面Development／Demo；Production OS暫緩

**理由：** 使用者確認Development與Demo沿用目前Windows桌面電腦，並撤回本輪對Windows Server的Production OS選擇，要求Production部分暫不決定。

**影響：** P0的`local_development`／`lan_development`在目前受支援Windows桌面環境執行；Windows path、NTFS ACL、Private network profile、Firewall與Node.js 24行為列入驗證。HTTP LAN仍只接受synthetic allowlist資料，不啟用Production auth、真實資料或Production credentials。Production OS保持未決；文件與程式不得假設Windows Server或Linux，也不先配置Production service、reverse proxy或TLS。D-061的同機App／PostgreSQL拓撲決策維持不變，但其OS與實際部署工作延後。

### D-063：原生Node.js＋pnpm啟動P0

**理由：** 使用者選擇在目前Windows桌面直接使用Node.js 24與pnpm啟動Next.js，避免P0引入Docker Desktop、WAMP／Apache reverse proxy或Windows Service的額外網路與維運層。

**影響：** P0以repository鎖定的pnpm scripts與受驗證launcher啟動Next.js；launcher必須將`RENTPROOF_BIND_HOST`／`RENTPROOF_PORT`實際傳入listener。`local_development`只綁loopback；`lan_development`只綁本機明確RFC1918位址，拒絕`0.0.0.0`／`::`／public address。WAMP／Apache、IIS、Docker與Windows Service不在P0 request path，也不為RentProof建立proxy或額外port exposure。LAN Windows Firewall只允許Private profile並依後續D-065／D-066控制scope與啟用狀態，Node process不以Administrator執行。日常開發與正式Demo模式由D-064決定。

### D-064：Dev Server開發＋Production Build正式Demo

**理由：** 使用者選擇保留日常開發的快速HMR，同時讓正式Demo避開臨時編譯、error overlay、開發source map與HMR斷線，提升90秒展示穩定性。

**影響：** 日常開發使用Next Dev Server；正式Demo先建立Production Build，再由validated launcher以`RENTPROOF_DEPLOYMENT_PROFILE=lan_development`、synthetic-only與Fixture預設啟動。`NODE_ENV=production`只代表Next build/runtime最佳化，不得被當成RentProof Production授權；資料、auth、cookie、storage與network能力只由deployment profile discriminated union決定。`lan_development`允許Next development或production runtime，但兩者都必須`RENTPROOF_ALLOW_REAL_DATA=false`、無Production adapters／credentials且只接受manifest allowlist。正式Demo不啟用HMR、不發布browser／server source maps或詳細error overlay；`.next`等build artifacts不提交。Scaffold後才建立並記錄實際pnpm scripts，不在文件先虛構可用指令。

### D-065：Firewall允許整個Windows Private Network

**理由：** 使用者選擇讓Windows標記為Private的目前網路中所有可達裝置都能連線，優先避免展示裝置DHCP位址變動或臨時新增裝置時修改來源allowlist。

**影響：** `lan_development` Windows Firewall inbound rule可在Private profile對整個網路來源開放，但只限RentProof指定TCP port與本機明確RFC1918 bind address；Public／Domain profiles不開放，listener仍拒絕`0.0.0.0`／`::`／public IP。Router port forwarding、UPnP、DMZ、tunnel與公開proxy維持禁止。Startup必須確認目前介面確為Private、bind／origin／Host allowlist一致，且synthetic manifest、無Production auth／credentials與rate limits通過；否則拒絕啟動。此選擇允許同網段非展示裝置存取Demo，因此UI持續顯示HTTP／synthetic-only警告且不得放入真實資料。Firewall rule應永久存在或只在Demo期間啟用仍待下一決策。

### D-066：Firewall Rule預設停用

**理由：** 使用者選擇保留已設定且可重複使用的Firewall Rule，但平時停用，以兼顧Demo便利性與D-065整個Private Network來源的暴露風險。

**影響：** RentProof LAN Demo Rule建立後預設及重新開機後維持disabled；Demo前由獨立、需UAC的管理腳本只執行scope驗證與enable，Demo結束後由另一獨立腳本disable。管理腳本不得啟動Node或把elevated token／environment傳給App；Next.js仍由一般使用者另行啟動。`lan_development` preflight需確認rule enabled、Private profile、指定local IP／port且Public／Domain未套用；`local_development`或Demo結束檢查若發現rule仍enabled，回明確警告／Gate failure與停用指引。實際PowerShell命令、固定rule name與驗證測試待Scaffold後建立，不能在未驗證前寫成可用指令。

### D-067：Windows LocalAppData Runtime

**理由：** 使用者選擇Windows每使用者本機App Data作P0 runtime預設，讓quarantine、sanitized derivatives、JSON state與cache離開repository及通常會同步的Documents目錄，同時免除每次手動設定路徑。

**影響：** `RENTPROOF_RUNTIME_DIR`未設定時，validated config resolver使用目前standard user的`%LOCALAPPDATA%\RentProof\runtime`；若`LOCALAPPDATA`缺失、非absolute local fixed NTFS或無法建立安全目錄則fail closed，不退回`%TEMP%`、cwd或repository。允許以`RENTPROOF_RUNTIME_DIR`覆寫，但必須是absolute local fixed path，且不得位於／包含repository、`RENTPROOF_DEMO_DIR`、`public/`、Documents／OneDrive等同步位置、UNC／network share、removable drive、symlink／junction／其他reparse point。建立後驗證real path與ACL只供目前使用者／必要system principals，分離`quarantine`、`artifacts`、`state`、`cache`子目錄；Demo素材不得複製進runtime。清理期限仍待下一決策。

### D-068：Development 7天＋Formal Demo結束清除

**理由：** 使用者選擇讓日常開發保留短期除錯狀態，同時避免正式Demo的quarantine、cache、state與衍生檔在展示電腦長期累積。

**影響：** `local_development`與非正式LAN test的每個runtime run以app-managed manifest記錄`created_at`／`last_written_at`，最後寫入後最多保留7個日曆日；讀取、polling或單純啟動不得延長。Formal Demo每次建立不可猜測的獨立run child，正常停止後立即進入cleanup；異常中止的abandoned formal run在下次啟動新Demo前清除。Rejected／invalid quarantine bytes在request結束或最短可行時間清除，不等待7天。Cleanup只操作已解析且位於D-067 validated root下的app-owned child：取得cleanup lock、拒絕active run、重新驗證real path／volume／reparse／ownership marker後再刪除，不follow links、不刪runtime root、repository或Demo。清除失敗需顯示明確警告並阻擋「環境已清乾淨」宣稱；P0不把cleanup描述成Production deletion SLA。

### D-069：Demo預設位於Windows使用者目錄

**理由：** 使用者選擇把外部Demo素材放在Windows使用者目錄，與`Documents\ChatGPT\RentProof` repository及LocalAppData runtime進一步分離。

**影響：** 預設Demo path由程式以`%USERPROFILE%\RentProof-Demo`解析，不硬編碼使用者名稱；`RENTPROOF_DEMO_DIR`仍可顯式覆寫。Path必須已存在、absolute local fixed NTFS、非UNC／network／removable／reparse，且不與repository、runtime、public或OneDrive／同步目錄重疊。缺失時回`DEMO_DIR_MISSING`，App不得自行建立、生成素材或從repository複製。Runtime只讀取經manifest標示`synthetic: true`且hash相符的檔案，不寫入Demo root。該資料夾不初始化Git repository；目前只記錄規劃，尚未建立目錄。素材版本管理方式仍待下一決策。

### D-070：Immutable Demo Versions＋Manifest Hash

**理由：** 使用者選擇在不使用Git的外部Demo資料夾中，以明確版本與hash維持Golden case可重現性，避免展示前直接覆寫素材造成truth、fallback與測試漂移。

**影響：** Demo root下使用`cases/golden-v1/`、`golden-v2/`等版本child；每版包含`manifest`、`listing/`、`viewing/images/`、`contract/`、`follow-up/`、`interaction/`、`truth/`與`fallback/`。Manifest列出schema／case version、`synthetic: true`、created／sealed metadata，以及每個檔案的normalized relative path、kind、MIME、bytes、SHA-256、source／license provenance；sidecar seal保存manifest本身hash，避免self-reference。封存後任何素材、truth、fallback、manifest或expected result變更都建立新版本，不修改舊版。App只載入顯式指定版本，不自動選`latest`，逐檔驗證hash／size／MIME／path containment；缺檔、額外未列檔、hash或seal不符皆fail closed。Truth是人工assertions，Fallback是帶model／prompt／schema／rules provenance的分析snapshot，兩者不得互相覆寫或推導。Manifest實際格式仍待下一決策。

### D-071：Strict JSON Manifest＋Zod／JSON Schema

**理由：** 使用者選擇與TypeScript邊界驗證一致的JSON格式，避免YAML implicit typing／anchors／tags與額外parser行為，並讓同一contract可供Runtime、測試與外部素材檢查使用。

**影響：** 每版使用`manifest.json`與`manifest.sha256`。Manifest必須UTF-8無BOM、RFC JSON、無comments／trailing commas，先以最大1 MiB讀取raw bytes；sidecar是該raw bytes的lowercase SHA-256 hex，先驗seal再將parse結果視為`unknown`通過strict Zod schema。Schema ID固定`rentproof.demo-manifest.v1`並輸出對應JSON Schema；拒絕unknown keys、duplicate semantic IDs、超過100 file entries、非有限數值及case-insensitive path collision。Paths使用forward-slash normalized relative form，拒絕absolute、drive、UNC、`..`、`.`、empty segment、NUL、Windows reserved names與trailing dot／space；逐檔仍做realpath containment、MIME／bytes／SHA-256驗證。封存工具以固定2-space＋LF及path字典序輸出，但App seal驗證以exact raw bytes為準，不在驗證前重寫／canonicalize。Manifest內容一律是不受信任資料，不執行其中字串。版本選擇機制仍待下一決策。

### D-072：環境變數顯式選擇Golden Version

**理由：** 使用者選擇讓每次執行明確指出Golden版本，避免資料夾排序、`latest` alias或新增版本後的隱性切換改變Demo結果。

**影響：** `local_development`／`lan_development`要求`RENTPROOF_DEMO_CASE_VERSION`，值只接受lowercase ASCII `golden-v`加不含前導零的正整數，例如`golden-v1`；拒絕missing／empty、whitespace、case variant、`latest`、`.`／`..`、slash／backslash、drive／UNC、URL encoding與額外suffix。Resolver只把驗證後的單一segment接到`RENTPROOF_DEMO_DIR\cases\`，再做D-069／D-071 realpath、seal與manifest驗證；不掃描或自動挑選其他版本。Active version、manifest SHA-256、schema／truth／fallback provenance寫入runtime snapshot、正式Demo metadata與報告頁，但不揭露absolute path。Scaffold後的launcher／formal-demo script需要求此值；格式或sealed case無效時fail closed且不退回另一版。

### D-073：OpenAI Key使用`.env.local`

**理由：** 使用者選擇Next.js原生支援、單人P0設定成本最低的repo-root `.env.local`，並以ignore、ACL、server-only boundary與secret scans控制公開repository誤提交風險。

**影響：** Scaffold後`OPENAI_API_KEY`只寫入repo root的`.env.local`，該檔必須由ignore規則排除、`package／build／source` secret scan拒絕出現內容，NTFS ACL不得授權其他一般使用者群組讀取；Administrators／SYSTEM等必要OS principals需記錄並最小化。Repository只提供不含值的`.env.example`。禁止`NEXT_PUBLIC_*` key、client env access、OpenAI browser call、hardcode、command-line argument、URL、PowerShell history、log／telemetry／error serialization、HTML／RSC payload、source map、`.next`／test artifact或fallback provenance洩露。只有server-side OpenAI adapter可讀；Fixture mode不要求key、不組裝live adapter且network count為0。Formal Demo預設Fixture，即使`.env.local`存在也不得發OpenAI request。若ACL／ignore／bundle scan無法驗證，Live mode fail closed。Production secrets不使用此Development檔案。現在只記錄規劃，不建立`.env.local`或API key。

### D-074：Conversation-first＋Structured Evidence Workspace

**理由：** 使用者希望以對話方式完成RentProof操作，並選擇讓對話成為主要流程、原有四個結構畫面成為隨時可開啟的證據工作區，而不是在Dashboard旁附加聊天助手或只保留純聊天紀錄。

**影響：** 單一案件route預設顯示guided conversation timeline與composer，系統依固定case state machine逐步詢問廣告、看屋、證據、契約、付款互動、補件與報告；在對話內嵌Upload、Candidate Confirmation、Finding、Evidence Locator、Follow-up及Report Action cards。摘要、證據矩陣、契約檢查、簽約前報告仍是同一snapshot的四區Evidence Workspace：Desktop可作side panel／secondary view，Mobile作full-screen route／sheet，不新增第五個workspace tab。User message或LLM文字不得直接寫Claim／Observation／Clause／Finding／金額／規則結果；先產生schema-validated typed command／fact candidates，material change需顯示來源與確認卡，由使用者確認後才呼叫既有application use case。Conversation是case projection，不是domain真相、自治Agent或自由Stage DAG；報告不列印原始聊天。Fixture與Live使用同一conversation contract，provider failure不得改寫為成功。P0 LAN的內容型自由文字仍受synthetic-only限制；允許程度與quick reply策略待下一決策。

### D-075：Free-text-first Conversation

**理由：** 使用者選擇完全自由文字為主要操作方式，優先自然對話體驗，而不是以quick replies／按鈕或wizard作主要輸入。

**影響：** Composer預設為multi-line free-text，suggested prompts只可作非必要輔助，所有核心流程都必須能以鍵盤文字完成。Server先做length／encoding／rate／owner／policy Gate，再由ConversationIntentExtractor產生strict typed intent／fact candidates；Live可使用OpenAI Structured Outputs，Fixture使用相同schema的deterministic adapter。模型沒有tools、database、filesystem、URL fetch或stage-selection權限；raw assistant text不能成為command。Read-only navigation／explanation intent可直接回snapshot-bound block；新增／修改費用、承諾、付款事實、artifact association、補件完成、刪除或policy事件等material action必須顯示CandidateConfirmationCard並由使用者確認。Unknown／ambiguous intent要求澄清，不猜測也不靜默執行。Raw text視為不受信任case data，需escape、no raw HTML、no prompt／response logs與owner-scoped retention。P0 LAN arbitrary free text與D-025／synthetic-only Gate衝突，必須由下一決策選擇受限Demo策略；在解決前不實作LAN free-text ingestion。

### D-076：LAN Free Text＋Prompt Injection Capability Isolation

**理由：** 使用者選擇在HTTP LAN Demo也全面開放自由文字，並要求防範Prompt Injection。此決策接受同網段明文傳輸與無法技術保證文字為synthetic的剩餘風險，但不放寬artifact、auth、secret、tool或domain-write邊界。

**影響：** D-076解決D-075的LAN blocker，並對D-025的synthetic-only作窄例外：`lan_development`可接受arbitrary conversation text，但仍不得上傳manifest外artifact、啟用Production auth／credentials或把文字當成已驗證證據；UI持續明示HTTP可能被旁聽／竄改、不得輸入真實姓名、地址、電話、帳號、租約或其他個資，並以best-effort PII patterns阻擋明顯輸入，但不得宣稱能保證偵測所有真實資料。Fixture在本機處理且不發OpenAI；Live只有操作者顯式啟用、Cloud Notice已完成且Development Project Gate通過才送OpenAI。

Prompt Injection控制採能力隔離：Conversation request只提供最小structured case projection與目前user turn，不帶API key、system secrets、raw document instructions、完整歷史或unneeded PII；OpenAI Responses固定`tools: []`、`store: false`與strict JSON Schema Structured Outputs。模型只可回`read_only_intent`、`material_candidate`、`clarification_needed`、`rejected`union，不能輸出可執行command／URL／SQL／path。Server重新Zod驗證、allowlist intent與field、owner／policy／case revision及candidate source；material candidate產生server-side opaque confirmation ID＋payload hash＋expiry，只有同actor明確確認且revision未變才呼叫對應application use case。Client不能自報confirmed、result或stage。Conversation／evidence extraction分開prompt與context，文件內指示永遠是quoted untrusted data。Raw assistant text不渲染HTML、不作command；refusal／incomplete／schema invalid／unknown locator／injection suspicion皆fail closed或要求澄清。直接／間接注入、role spoof、prompt leakage、JSON smuggling、Unicode、超長輸入、偽造confirmation與cross-case replay列入E2E。Turn大小與rate具體上限仍待下一決策。

### D-077：Conversation Turn 2,000 Characters／8 KiB

**理由：** 使用者選擇讓一般自然語言對話有足夠空間，同時把契約／長廣告導向既有檔案上傳流程，降低context flooding、資源耗盡、成本與超長Prompt Injection面積。

**影響：** 每個user free-text turn在body streaming層最多接受8 KiB raw bytes；超限立即停止讀取並回`CONVERSATION_TURN_TOO_LARGE`。Bytes必須為strict UTF-8，拒絕invalid encoding與NUL；解析後做Unicode NFC normalization，再以Unicode code points計數，最多2,000，不用JavaScript UTF-16 `.length`或grapheme approximation。Server不截斷、不摘要、不把超限內容寫runtime／log／audit，也不呼叫Fixture／OpenAI。Client顯示即時計數但Server為唯一權威；附件走獨立受控upload endpoint，不計入文字額度也不能以base64／data URL塞入turn。控制字元、bidi／zero-width與homoglyph不單靠刪除處理，保留可稽核的normalization／risk reason code並納入Injection tests。Assistant output與turn rate另行決定。

### D-078：Conversation Rate 10／Minute、Burst 3、Concurrency 1

**理由：** 使用者選擇足以支援一般連續對話、同時限制Prompt Flooding、重複提交、Revision Conflict與OpenAI成本的保守速率。

**影響：** 使用server-side monotonic-time token bucket：每個guest／user Actor每60秒補充10 tokens、最大burst 3；另套用來源IP bucket，兩者都需有額度。每個case最多1個in-flight conversation turn；第二個不同turn回`CONVERSATION_TURN_IN_PROGRESS`，不平行送模型。每個turn要求opaque client idempotency key並綁actor／case／normalized payload hash；相同key＋相同hash回既有pending／result且不重複扣額度或呼叫adapter，相同key不同hash回`IDEMPOTENCY_KEY_REUSED`。所有送達的attempt（包含invalid／injection／oversize）計入IP abuse bucket；通過最小header／actor Gate後才使用Actor bucket。超限回429 `CONVERSATION_RATE_LIMITED`與bounded `Retry-After`，不保存turn或呼叫模型。Fixture／Live使用相同Gate；rate limiter失效時Live fail closed，Fixture可回明確configuration failure而不假裝成功。Assistant output上限仍待下一決策。

### D-079：Assistant 600 Code Points／3 Cards

**理由：** 使用者選擇讓每輪對話聚焦一個決策並保持Mobile閱讀清楚，完整矩陣與長清單則交由Evidence Workspace呈現。

**影響：** 每個assistant turn的narrative text經NFC後最多600 Unicode code points，typed cards最多3張；cards內容本身仍受各自schema／field limits，不可把長文拆進card繞過。排序由Server deterministic policy決定：安全／付款前停止與待確認candidate優先，其次當前下一步與evidence locator；不得讓LLM自由排序或隱藏blocking item。若還有其他validated items，回`remaining_item_count`與固定「前往證據工作區」action，所有內容仍留在同一snapshot。Live Structured Output schema對text與cards設上限，Server再驗；超限、unknown card或引用不存在不silent truncate／drop，而回`ASSISTANT_OUTPUT_SCHEMA_INVALID`並顯示安全的固定重試／workspace提示，不把錯誤當成沒有問題。Fixture與Server template也受相同限制。Print report不使用此600／3限制，而依結構化report contract完整輸出。Confirmation有效時間仍待下一決策。

### D-080：Confirmation TTL 10分鐘

**理由：** 使用者選擇短期確認窗口，降低舊candidate在案件狀態、owner context或使用者意圖已改變後被重放的風險，同時保留足夠閱讀確認卡的時間。

**影響：** Material candidate由Server產生不可猜測opaque confirmation ID，綁定actor ID／kind、case ID、case revision、candidate type、canonical payload hash、created／expires time與one-time status；有效10分鐘。ID不包含payload／PII、不放URL，僅在受CSRF／Origin與owner保護的POST body使用。Confirm以原子compare-and-set驗證未使用、未撤銷、未過期、同actor／case、revision與payload hash完全一致後才執行allowlisted use case，成功或失敗後依policy消耗，避免race／double-click。任何case revision、logout／guest expiry、owner transfer、policy version change或candidate edit都使舊confirmation失效。逾時回`CONFIRMATION_EXPIRED`；revision差異回`CONFIRMATION_STALE`；重播回`CONFIRMATION_ALREADY_USED`，不得合併成generic success。重新產生需從目前state建立新candidate／ID，不延長或復活舊ID。刪除、帳戶、credential、policy／cloud consent等高影響動作仍需專用reverification，不只依賴此TTL。

### D-081：Current Turn＋Structured State＋Focus Refs

**理由：** 使用者選擇不把最近或完整raw chat history反覆送給模型，以降低持續性Prompt Injection、PII重複外送與token成本，同時用Server驗證的focus reference保留自然追問能力。

**影響：** 每個ConversationIntentExtractor request只含：(1)目前已通過D-077的normalized user turn；(2)allowlisted ServerConversationState，例如case phase、snapshot／revision、available actions、pending candidate types與known／unknown flags；(3)零至少量ValidatedFocusRef，指向上一個或使用者明確選取的assistant card／finding／claim／clause／action。不得包含先前raw user／assistant text、完整conversation transcript、raw contract／image instructions、absolute path、secret或不必要PII。Focus ID由Server依actor／case／snapshot解析為最小typed excerpt；client提供的ID只是候選，cross-case、stale、unknown或非allowlist ref拒絕。若「為什麼／修改它」等省略語沒有唯一有效focus，回`CONVERSATION_FOCUS_REQUIRED`並要求澄清，不猜測。Structured context schema／version／hash與focus IDs進StageRun provenance；Fixture與Live共用contract，`store: false`且不使用OpenAI Conversations API。UI仍可從owner-scoped repository顯示原始聊天，但顯示權限不代表模型context權限。此設計降低而非消除目前turn本身的Prompt Injection風險。

### D-082：General PII Warning／Allow；Auth Secrets Hard Block

**理由：** 使用者選擇LAN偵測到姓名、地址、電話、Email等疑似一般個資時只警告、仍允許明確繼續，以保留完全自由文字操作；同時既有密碼、OTP、API key與token不可進OpenAI／log的安全邊界不因本選擇解除。

**影響：** Client在首次network send前以best-effort patterns顯示HTTP明文、可能被攔截與不得輸入真實資料的warning；Server收到後再做獨立分類。疑似一般PII回`PII_WARNING_REQUIRED`，在保存或呼叫模型前要求使用者以綁actor／case／revision／normalized payload hash、10分鐘、單次的warning acknowledgement明確繼續；不得預勾、自動重送或把警告藏在Terms。Acknowledged PII可依目前Fixture／Live與retention流程處理，且Live仍需Cloud Processing Notice。這不能防止第一次HTTP request已被旁聽，也不能保證PII偵測完整；UI、文件與Demo script必須明說。

Password、OTP／reset code、OpenAI／provider API key、Authorization／session／refresh token、private key與其他authentication secret使用獨立`AUTH_SECRET_DETECTED`hard block：不保存、不log、不audit raw value、不呼叫Fixture／OpenAI，且warning acknowledgement不可繞過。完整銀行／信用卡／收款帳號、QR／data URL及身分證影像仍不屬P0 allowed data；偵測時hard block，避免與D-018防詐synthetic fact混淆。Detector只做defense-in-depth，不把「未偵測」描述為安全。Production PII處理仍需HTTPS、Privacy／Cloud Notice、owner retention與法務Gate。

### D-083：Raw Conversation Text Retention 7天

**理由：** 使用者選擇短期保留原始對話以支援查看與除錯，同時避免可能含PII、Prompt Injection或不必要敘述的raw text隨帳戶案件長期保存；結構化證據與確認事件仍可維持產品歷史價值。

**影響：** Raw user／assistant conversation text自turn建立起固定保存7個日曆日，不因查看、下載、追問、登入或背景處理延長；到期立即從一般讀取隱藏並於24小時內完成online purge。Guest D-055 24小時、Formal Demo D-068 stop cleanup、案件／帳戶刪除D-058等更短期限優先。Purge後保留不含raw content／reversible hash的opaque turn ID、role、created／purged time、typed intent／candidate／confirmation／snapshot references與stable reason codes，供timeline重建與稽核；不得保留raw excerpt、embedding、search index、prompt cache key或可離線猜測內容的unsalted hash。UI以typed cards／events重建，必要時顯示「原始訊息已依7天政策清除」，不可偽造原句。

Raw text不得進general logs／security audit；online store、cache、search與適用provider file objects一併purge。Production不可變backup仍可能依D-059自建立起最多14天保留已過期raw text，restore前以最小retention tombstone重播清除；tombstone遵守21天且不含內容。Account case的Claims／Evidence／Findings／Report與typed events仍保存至使用者刪除，不能因raw text清除而失去locator或改變判定。Model context依D-081本來就不讀raw history。Privacy／UI需分開揭露online 7天與backup輪替。

### D-084：Hybrid Assistant Response

**理由：** 使用者選擇兼顧自然對話與證據安全：不可變的安全／狀態訊息由Server決定，一般唯讀說明才讓LLM在已驗證資料邊界內改寫表達。

**影響：** Server-only response kinds包含security／HTTP／PII／auth-secret warnings、policy／cloud notice、validation／provider errors、CandidateConfirmationCard內容與按鈕、Claim／Rule／Fraud結果名稱、`stop_and_verify`、priority／remaining count、deletion／retention及所有高影響CTA；LLM不得產生、覆寫、隱藏或重新排序。Read-only explanation可呼叫LLM，但input只含D-081 structured state／focus refs及allowlisted verified facts／locators；output是strict `ExplanationSegment[]`，每段text綁一個以上source refs或明確`insufficient_information` reason，總敘述仍受D-079 600 code points。Server驗證所有refs屬同case／snapshot、沒有new fact／forbidden phrase／unapproved action，cards仍由Server composer決定。

LLM explanation schema／semantic eval失敗、refusal、incomplete、timeout或無有效locator時，不使用自由文字fallback、不改為「沒有問題」；顯示固定Server error／insufficient template與Workspace入口。Fixture mode完全使用相同Server templates＋deterministic explanation fixture，不發網路。Report、確認表與官方規則說明仍由deterministic composer產生，不從raw conversation或LLM prose複製。UI需區分「系統狀態／確認」與「AI協助說明」，但不以低對比免責。Conversation model routing仍待下一決策。

### D-085：Luna Conversation＋Terra Evidence Routing

**理由：** 使用者選擇依工作負載分流性價比：高頻、短文字、嚴格schema的intent／read-only explanation使用OpenAI定位為cost-sensitive high-volume的Luna；廣告、影像、契約與付款事實抽取維持智慧／成本平衡的Terra。

**影響：** D-085取代D-016的單一模型預設。`conversation.intent`與`conversation.explain`固定`gpt-5.6-luna`＋`reasoning.effort: low`；`listing.extract`、`evidence.extract`、`contract.extract`與`interaction.extract`固定`gpt-5.6-terra`＋`medium`。兩者都使用Responses API、`service_tier: default`、`store: false`、strict Structured Outputs及`tools: []`。Luna只接收D-081 text／structured context，不接圖片或raw documents；Terra不接conversation raw history。Ambiguous／low-quality Luna結果要求澄清或回固定error，不自動升級Terra；provider／model不可用也不互相fallback。

Config拆成`OPENAI_CONVERSATION_MODEL`／`OPENAI_CONVERSATION_REASONING_EFFORT`與`OPENAI_EVIDENCE_MODEL`／`OPENAI_EVIDENCE_REASONING_EFFORT`，各自只接受上述allowlist。StageRun／AnalysisSnapshot／cache key／fallback provenance記錄route、requested／resolved model、effort、prompt／schema／eval versions及usage。Conversation與Evidence建立分開Golden／Injection／schema／locator eval；Luna未達intent accuracy、false-material-action、injection resistance或source-bound explanation門檻時，不改用Terra掩蓋，而是阻擋Live conversation並保留Fixture／Server templates。D-037的16 attempts／500K／50K等case budget暫只視為Evidence pipeline budget；Conversation budget需下一決策另訂。依2026-09-02 OpenAI Docs，Luna標準文字價格為input US$0.20／MTok、cached US$0.02／MTok、output US$1.20／MTok；Terra為US$2／0.20／12，價格只作工程估算並需上線前重查。

### D-086：Conversation Luna Balanced Budget

**理由：** 使用者選擇足以支援約數十輪intent＋explanation的獨立Conversation額度，同時避免高頻聊天耗盡Evidence extraction Budget或在Prompt Flooding下無界增加成本。

**影響：** 每個case使用獨立、非滑動24小時Conversation budget window，自第一個Luna reservation建立`window_started_at／expires_at`；上限100個實際provider attempts（含SDK實際retry）、250,000 total input tokens與50,000 output＋reasoning tokens，Luna concurrency 1。Window到期後新request建立新window；client／user不能重設、延長或指定window。Application在request前以transaction原子reserve worst-case attempt／token allowance，完成後用provider usage reconcile；usage缺失標unknown，若下一次可能越過hard cap則停止，不填0或猜測。Cached input仍計入250K安全額度，但成本估算分開記錄cached usage。

Server templates、deterministic policy、Fixture adapter、validation failure在provider call前、rate-limited turn及same-key／same-payload idempotent reuse不扣provider attempts；已送出的refusal／incomplete／schema invalid與provider failure依實際request／usage計入。任一hard cap回`CONVERSATION_BUDGET_EXCEEDED`並保留Server-only功能／Workspace，不切Terra、不換Project／key規避。US$0.25是按2026-09-02價格的工程警戒，不是帳單hard limit；達警戒記錄minimal metric／UI configuration warning但不暴露cost internals給一般使用者。D-037 Evidence budget保持獨立。Development Luna Project rate limit仍待下一決策。

### D-087：Conversation Luna Generous Budget

**理由：** 使用者將Conversation Budget由選項1改為選項3，希望保留更充裕的自由對話、澄清與唯讀說明空間。

**影響：** D-087取代D-086的數值，其他budget semantics不變。每case non-sliding 24h window上限改為200 actual Luna provider attempts、500,000 total input tokens與100,000 output＋reasoning tokens，concurrency仍為1；工程警戒改為US$0.50。Atomic reserve／reconcile、unknown usage、cached input計入安全額度、Fixture／Server templates／pre-provider rejection／idempotent reuse不扣attempt、hard cap後保留Server-only功能且禁止切Terra／換Project或key等規則維持。依2026-09-02 Luna標準價格，token hard caps約對應US$0.22，不含價格變動與其他計費差異；US$0.50仍是工程警戒而非帳單保證。

### D-088：Development Luna Project 30 RPM／500K TPM／300 RPD

**理由：** 使用者選擇在單人P0中保留足夠的Conversation開發、eval與重跑空間，同時用Project層限制防止Application bug或key misuse直接碰觸帳戶Usage Tier上限。

**影響：** Development OpenAI Project對`gpt-5.6-luna`設定30 requests／minute、500,000 tokens／minute，以及Dashboard若提供model／project RPD欄位則300 requests／day。這是provider層上限，不取代D-078 Actor／IP 10 per minute、case concurrency 1或D-087 200-call／500K／100K budget；最嚴限制優先。若帳戶Tier或Dashboard允許值較低，採較低值並顯示configuration status，不提高Tier、拆Project、換key或重試規避。若沒有RPD欄位，Application 200-call fixed-window與US$100 monthly Project hard spend仍是主要日／成本控制，文件不得假裝RPD已啟用。Runtime／CI不持有Admin Key，設定由operator checklist／只讀可驗證狀態核對。Production使用獨立Project並另決定 limits；Development限制不得直接複製成Production承諾。

### D-089：自建Email／密碼Auth與7天Sliding Session

**理由：** 使用者明確捨棄Clerk並恢復7天滑動式Session需求。Demo要能在loopback環境驗證註冊、Email驗證、登入、忘記密碼、登出與歷史案件owner scope；Clerk固定Session能力不符合此互動需求。

**影響：** D-089取代D-047至D-051及D-024先前被取代的結果。認證由窄Application ports與PostgreSQL adapter實作；密碼只使用鎖版、已稽核安裝腳本的`argon2` Argon2id，最低參數固定`m=19456 KiB／t=2／p=1`，不得自製密碼雜湊。Email identifier經NFC、trim與lowercase正規化；註冊完成Email單次驗證前不得建立Account Session。Session使用256-bit隨機opaque token，資料庫只保存server-keyed HMAC-SHA-256 digest；Cookie為HttpOnly、host-only、明確SameSite，除精確loopback Demo外一律Secure。合格主動使用以同一原子DB更新延長7天idle expiry並同步刷新Cookie；狀態查詢、prefetch、polling、靜態資源與失敗request不延長。Logout、密碼重設、帳戶停用／刪除撤銷適用Session；敏感操作需15分鐘內密碼reverification。Email驗證與重設code為15分鐘、單次、digest-only；回應採generic message、Argon2 dummy verify、response floor與route rate limit。HTTP LAN仍不啟用帳戶Auth、Session、reset或history；自建Auth只允許精確loopback Demo或HTTPS。Clerk SDK、keys、mapping與Dashboard Gate移除。真實資料啟用仍需SMTP／Email供應商、政策與完整Production Gate，不能因自建Auth存在而宣稱可處理真實資料。

### D-090：Apache License 2.0

**理由：** 使用者先要求MIT，隨後在尚未交付前改為Apache License 2.0；最終選擇以Apache-2.0的明確著作權、再散布與專利授權條款開放repository。

**影響：** D-090取代D-011與D-044的「公開但無License」決策，也取代同一工作階段未完成的MIT選擇。Repository根目錄保留標準`LICENSE`與`NOTICE`，`package.json.license`為`Apache-2.0`；README可明確稱為Apache-2.0授權的open-source repository。`private: true`仍保留以避免npm誤發布。第三方程式碼、官方來源快照與外部Demo素材不因專案授權而改變其各自權利；合併外部貢獻前仍需確認貢獻者有權依Apache-2.0提交。

### D-091：非自然死亡揭露核對，不作「凶宅」判決

**理由：** 使用者希望在租屋決策中納入俗稱「凶宅」的疑慮，但該詞不是本功能使用的法定結果。內政部住宅租賃契約範本附件一現況確認書，對租賃住宅專有部分在出租人持有期間，以及持有前且出租人知悉的期間，分別提供兇殺、自殺、一氧化碳中毒或其他非自然死亡情事的確認欄位；產品應忠實呈現該揭露，而非自行擴張定義。

**影響：** Domain只接受`yes／no／unknown`、兩個固定期間、事件類型與source locator。只有可定位的現況確認書、契約條款或出租人／仲介書面陳述可支持明確揭露；傳聞、地址搜尋、新聞與模型推測一律排除於肯定事實。相同期間明確yes／no互相衝突才標`contradicted`；缺件、unknown、無locator或只有排除來源均為`insufficient_evidence`。UI／報告只顯示揭露狀態與取得雙方簽署現況確認書、書面詢問、保存來源等行動；禁止輸出是／不是凶宅、合法／違法、機率、分數、責任、價格影響或黑名單。系統不依地址爬取或比對新聞。

### D-092：P1官方規則profile啟用四條延伸檢查

**理由：** P0 Golden流程已穩定，使用者要求繼續完成剩餘程式；RP-001契約審閱期、RP-002廣告整體排除、RP-005押金上限／返還及RP-007非按度／公共用電已有2026-09-01凍結官方來源，可在不改變P0的前提下升為P1 deterministic checks。

**影響：** P1 profile顯式啟用四條延伸規則，P0 active IDs與Golden expected results不變。所有輸入使用strict typed knowledge／presence states；適用性未知回`missing_information`，不適用建立null-result skipped check。只有含case locator的明確相反文字或數值可回`possible_difference`；文件不完整、欄位未知或無locator均fail closed。規則結果仍限`no_difference_found／possible_difference／missing_information`，不是合法性、責任或法律意見判決。規則庫仍為draft並須在Demo前重查來源。

## 尚待決定

| 問題                                | 決定時機                         | 決策證據                                                             |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| Transactional Email供應商與處理地區 | First real-data scaffold前       | DPA／subprocessors、Email deliverability、messaging費率與portability |
| Production Server作業系統           | First real-data infrastructure前 | PostgreSQL／Node支援、安全更新、維運熟悉度與成本                     |

## 新決策模板

```md
### D-XXX：標題

- 日期：YYYY-MM-DD
- 狀態：proposed | accepted | superseded by D-YYY
- 決策：
- 理由／證據：
- 影響與遷移：
```
