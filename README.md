# 租得明白 RentProof

> 把租屋廣告、看屋影像、契約與官方資料互相比對，在付訂金前找出矛盾、缺漏與尚未被證明的承諾。

RentProof 是一個「租屋決策證據 Agent」。它不判定物件是否為詐騙、條款是否違法或責任歸屬，而是把每一項廣告承諾連回可定位的現場證據、契約條款與官方規範，產生可在簽約前處理的確認清單。

## 解決的問題

租屋資訊分散在廣告、看屋紀錄、契約與官方規範中，同一項設備、費用或承諾常以不同說法出現。RentProof將這些來源整理成可追溯的證據關係，協助使用者在付款或簽約前看見矛盾、缺漏及尚未取得證明的事項。

## 核心功能

- 從廣告、照片與文字型契約PDF抽取可定位的候選資料。
- 以「支持、矛盾、證據不足」核對廣告承諾，不把沒拍到當成不存在。
- 依官方來源進行中立規則差異檢查，並產生補拍、詢問、修改或補入附件的行動。
- 整理固定月費、依用量變動費用與一次性費用。
- 顯示付款前風險訊號與非自然死亡揭露缺件，但不輸出詐騙、法律或責任判決。
- 提供conversation-first RWD操作、證據工作區與可列印的簽約前報告。

## 架構與技術

系統採TypeScript模組化單體與ports／adapters：Domain保存證據與規則語意，Application協調固定stage DAG，Infrastructure封裝OpenAI、PDF.js、Sharp、Windows private storage與PostgreSQL，Next.js App Router負責Server routes及RWD UI。四個Agent名稱代表固定管線階段，不是自治微服務。

主要技術為Node.js 24 LTS、pnpm、TypeScript 6、Next.js 16／React 19、Zod、OpenAI Responses API、Mozilla PDF.js、Sharp、Kysely／node-postgres、Argon2id、Vitest／Testing Library／axe與Playwright。完整依賴方向見[系統架構](docs/SYSTEM_ARCHITECTURE.md)，鎖定版本見[`package.json`](package.json)及[`pnpm-lock.yaml`](pnpm-lock.yaml)。

## 專案狀態

P0 Golden flow已實作：Next.js App Router conversation-first網站、四區證據工作區、受控自由文字Route Handler、六條官方規則、FRS-001、PDF.js／Sharp adapters、OpenAI Luna／Terra adapters、Windows JSON runtime、局部補拍重算、deterministic報告、安全與預算邊界，以及桌面／手機E2E。Windows Private Firewall規則、LAN Production Build、exact Host與Forwarded攻擊smoke已在本機完成；另一台實體LAN裝置的RWD／keyboard／200% zoom／screen-reader人工smoke仍待現場操作。第一版仍由單人開發，只使用完全虛構套房案例。

另已完成self-hosted Auth、Kysely與node-postgres的Demo-safe實作：Argon2id密碼、Email驗證／reset challenge、7天sliding session、owner-scoped history、PostgreSQL repositories與兩版凍結migration。此電腦的user-owned loopback synthetic cluster已實際套用`001_initial_real_data_schema`與`002_self_hosted_auth`，並完成ACL finalization、12-table readiness、owner／CAS DB smoke及Auth HTTP端到端smoke；測試資料已清除。這不代表真實資料Production已完成或可上線。

2026-09-03最終整合Gate的權威紀錄為118個Vitest檔案／1,110項測試通過，Fixture Production E2E為21 passed／3項刻意skip；Build、Prettier、ESLint、TypeScript與508-file Security Gate均通過。完整上下文見[開發紀錄](docs/DEVLOG.md)。

Repository採用[Apache License 2.0](LICENSE)並附有[NOTICE](NOTICE)；`package.json`仍維持`private: true`，避免誤發布為npm套件。第三方套件、官方來源快照與外部Demo素材仍依各自授權及來源條件使用。

Demo素材不放在本專案內；Windows P0預設使用`%USERPROFILE%\RentProof-Demo`，並可由`RENTPROOF_DEMO_DIR`安全覆寫。

雲端LLM固定使用OpenAI Responses API；Conversation intent／explanation使用`gpt-5.6-luna`＋low，廣告／影像／契約／互動證據抽取使用`gpt-5.6-terra`＋medium，所有API呼叫只由server發出。

Conversation每case使用固定24小時Luna Budget：200 calls、500K input、100K output＋reasoning、concurrency 1；與Evidence Budget分離，超限後仍可使用Server Templates與Evidence Workspace。

Development Project的Luna model limit為30 RPM／500K TPM／300 RPD（若Dashboard支援）；Application的較低Actor／Case限制仍優先。

Application runtime 固定使用 Node.js 24 LTS；Scaffold 時鎖定當時最新的 `24.x` 安全修正版，開發、CI 與部署使用同一版本線。

Web framework 固定使用 Next.js 16 Active LTS；Scaffold 時鎖定當時最新的安全修正版 `16.x`，不使用可自動跨 Major 的浮動版本。

開發階段允許使用 `lan_development` profile：以 HTTP 綁定一個明確的私人區域網路 IP，讓同一 LAN 的手機／電腦測試 RWD。此模式只接受 synthetic data，不啟用正式帳戶／密碼流程，也不得透過路由器 port forwarding 暴露到公網；Production 仍強制 HTTPS。

目前P0只在本機與私人LAN展示，不開放公網、VPS或Router Port Forwarding。`public_http_showcase`規格保留作未來選項，但目前停用、不Build、不部署；若重新啟用需新增決策。Production仍強制HTTPS。

未來真實資料版採單一網站入口：訪客可直接使用，註冊／登入只用來保存與跨裝置查詢歷史案件。未登入者必須先看到「案件不會出現在歷史紀錄，工作階段失效後可能無法找回」的提示。初期self-hosted帳戶支援Email驗證、註冊、登入、登出與Email重設密碼；SMS Recovery延後評估，初期不蒐集手機號碼。

訪客Session自建立起固定24小時且不滑動；到期後立即無法存取，相關線上案件資料於24小時內清除。登入不會自動保存，必須由使用者明確轉移案件到帳戶。

登入帳戶案件在帳戶有效期間保存至使用者刪除案件或帳戶；不採閒置自動到期，並在history／detail提供刪除控制。

帳戶案件刪除確認後立即停止存取且不可恢復，相關線上資料於7個日曆日內完成清除；Guest仍使用24小時清除SLA。

加密backup／PITR最多保存14天且只供災難復原；最小化deletion tombstone保存21天，任何還原都必須先在隔離環境重播刪除紀錄並驗證。

最小化security／deletion audit events最多保存180天，不包含案件內容、PII identifiers、完整request body或認證祕密。

First real-data Production將App與PostgreSQL放在同一台Server；PostgreSQL只接受本機連線且不開放DB port。此方案不具HA，加密backup必須存到off-host不同故障域。

Development與Demo使用目前Windows桌面電腦；Production OS暫不決定。Windows桌面的HTTP LAN profile只允許synthetic資料，不建立或連接Production環境。

P0以原生Node.js 24＋pnpm直接啟動Next.js，不使用Docker、WAMP／Apache proxy或Windows Service；local只綁loopback，LAN只綁明確私人IP。

日常開發使用Next Dev Server；正式Demo使用Production Build，但仍套用`lan_development`的HTTP、synthetic-only、Fixture預設與無Production credentials限制。

LAN Demo的Windows Firewall允許整個Private Network連入RentProof指定IP／port；Public／Domain profiles與Router對外轉發禁止，因此同網段任何裝置都可能看到Synthetic Demo。

Firewall Rule會保留但預設停用，只在Demo前後由獨立管理腳本啟用／停用；Node App本身維持一般使用者權限。

P0 runtime預設存於目前Windows使用者的`%LOCALAPPDATA%\RentProof\runtime`，與repository及外部`RentProof-Demo`分離；不使用TEMP、Documents／OneDrive或共享路徑。

外部Synthetic Demo素材預設位於`%USERPROFILE%\RentProof-Demo`；App只讀、不自動建立，也不將該資料夾初始化為Git repository。

Demo以`cases/golden-vN`不可變版本管理；manifest與sidecar hash封存所有素材、人工truth及分析fallback。修改時建立新版本，App不自動選latest。

Manifest使用strict JSON `manifest.json`＋raw-byte SHA-256 `manifest.sha256`，由Zod／JSON Schema驗證；任何未知欄位、路徑碰撞、越界或hash不符均拒絕載入。

啟動時必須設定`RENTPROOF_DEMO_CASE_VERSION=golden-vN`；不提供預設、latest或UI選版，實際version與manifest hash會顯示於Demo provenance。

Windows Development的OpenAI Key在Scaffold後只放repo-root `.env.local`，該檔不提交且限制ACL；repository僅提供空值`.env.example`。Fixture Demo不使用Key或呼叫OpenAI。

Development runtime最後寫入後保留最多7天；正式Demo使用獨立run並於結束清除，異常中止的run在下次Demo前安全清理。

第一個帳戶Demo改採self-hosted Auth，透過Application ports隔離Argon2、PostgreSQL、Cookie與Email delivery；正規化Email只作登入identifier，RentProof內部`userId`才是owner key，Client UI狀態不取代Server-side authorization。

帳戶Session使用32-byte CSPRNG opaque Cookie，PostgreSQL只保存server-keyed HMAC digest。合格主動使用以原子DB更新延長7天idle expiry並刷新Cookie；passive status／polling不延長。Logout、reset及帳戶停用會撤銷Session。

PostgreSQL存取固定採Kysely＋node-postgres並封裝於infrastructure adapter；Golden flow仍使用記憶體／Windows JSON state。Demo-safe PostgreSQL adapter、owner-scoped repositories與migration程式已存在，但必須由明確環境設定啟用，不會因安裝套件自動連線或自動migration。

PostgreSQL schema升級使用Kysely Migrator與版本化TypeScript migration，僅透過獨立部署／維運程序執行，不由Web request自動執行。

正式環境migration採forward-only＋expand／contract；正式環境不直接執行`down`，失敗時回退相容程式或新增修正migration。

MVP 必須完成：

- 一份模擬租屋廣告、一份清楚的文字型模擬租約，以及 12 張看屋照片；影片列為 P1。
- 廣告／現場／契約三方比對。
- 每一項廣告承諾只使用「支持、矛盾、證據不足」三種結果。
- 規則庫保留 10 條草案，P0 啟用其中 6 條與 Golden case 直接相關的官方規則。
- 規則 Profile 由 Server-only `RENTPROOF_RULE_PROFILE=p0|p1` 選擇；預設與 LAN Golden 維持 `p0`，只有啟動前明確選 `p1` 才顯示全部 10 條，瀏覽器與請求不能覆寫。
- 至少一次具體補拍或補件回合。
- 一組「詐騙風險訊號」檢查與付款前查證行動，但不作詐騙判決。
- 一組專有部分非自然死亡揭露檢查：分開核對出租人持有期間與持有前且其知悉期間，只採可定位的明確勾選／書面陳述，不作俗稱「凶宅」判決。
- 對話式主要操作流程，內嵌上傳／確認／證據／補件／報告行動卡；另有摘要、證據矩陣、契約檢查、簽約前報告四區證據工作區與中立可列印報告。
- 對話以自由文字為主要輸入；唯讀詢問可直接回覆，會改變案件資料的候選必須由確認卡確認。
- LAN Demo亦開放自由文字，但仍是HTTP且禁止真實資料；Prompt Injection以無tools、Strict Schema、Server Allowlist、actor／revision-bound confirmation與prompt context分離限制影響。
- 單則自由文字最多8 KiB raw UTF-8且NFC後2,000 Unicode code points；超限不截斷、不保存或送模型，長內容改走檔案上傳。
- Conversation每Actor與來源IP每分鐘10則、burst 3，每case同時1則；idempotency避免重複模型請求。
- Assistant每輪最多600 Unicode code points與3張cards；其餘結果保留在Evidence Workspace與完整列印報告。
- Material Candidate確認ID有效10分鐘、單次使用，並綁定Actor、Case Revision與Payload Hash；案件變動後必須重新產生。
- 模型只接收目前訊息、Server結構化狀態與Validated Focus Refs，不接收最近或完整原始聊天；模糊指涉會先要求澄清。
- LAN一般PII疑慮警告後可明確繼續，但HTTP仍可能暴露內容；密碼、OTP、API／session token、完整金融帳號與QR等秘密維持不可繞過Hard Block。
- Raw user／assistant文字保存7天後清除；Typed Candidates、Confirmations、Findings、Evidence與Report依案件政策保留，timeline不偽造已清除原句。
- Assistant採Hybrid：Server Template鎖定安全、確認、三態、優先順序與CTA；LLM只解釋已驗證且附Locator的唯讀事實。
- 通過 API key、上傳檔案、prompt injection、資料外送、模型錯誤與禁止措辭等 P0 Security Gate。

## 核心原則

1. 每個結論都要有來源定位：廣告區塊、照片、影片時間碼、契約頁碼或官方網址。
2. 「未拍到」只代表證據不足，不代表設備不存在。
3. 影像中的痕跡只能描述為可觀察現象，不能據此判定漏水、結構安全或責任。
4. OpenAI Cloud LLM 只負責抽取與語意候選；三態分類、金額運算、官方規則與報告由本機程式判斷。
5. UI 不使用「確定違法、確定詐騙、房東有責」等結論性措辭。
6. 防詐功能只輸出可定位訊號、資料不足與查證行動，不輸出詐騙機率或安全分數。
7. 非自然死亡揭露只呈現明確`yes／no／unknown`與來源；傳聞、地址搜尋、新聞或模型推測不能形成肯定事實，也不輸出機率、責任、價格影響或黑名單。
8. 網站採 mobile-first RWD 與極簡主義；簡單乾淨、證據優先，不使用重型圖表、評分儀表或不必要動畫。
9. 真實資料版的訪客與登入案件都必須是私有、owner-scoped；未登入只代表不保存歷史，不代表資料公開。
10. 第一版只使用必要 Cookie；隱私告知、使用條款、OpenAI Cloud 告知與非必要 Cookie 選擇分開記錄。

## 規劃文件

- [產品規格](docs/PRODUCT_SPEC.md)
- [系統架構](docs/SYSTEM_ARCHITECTURE.md)
- [Server 配置](docs/SERVER_CONFIGURATION.md)
- [UI／RWD 設計](docs/UI_DESIGN.md)
- [技術設計](docs/TECHNICAL_DESIGN.md)
- [OpenAI Cloud LLM 整合](docs/OPENAI_INTEGRATION.md)
- [安全與隱私規格](docs/SECURITY_PRIVACY.md)
- [選用帳戶、登入與歷史租約架構](docs/AUTH_AND_HISTORY.md)
- [隱私政策草案](docs/PRIVACY_POLICY_DRAFT.md)
- [使用條款草案](docs/TERMS_OF_USE_DRAFT.md)
- [Cookie 政策草案](docs/COOKIE_POLICY_DRAFT.md)
- [租屋詐騙風險訊號](docs/FRAUD_RISK_SIGNALS.md)
- [官方規則與資料來源](docs/OFFICIAL_RULES.md)
- [實作計畫](docs/IMPLEMENTATION_PLAN.md)
- [優化清單](docs/OPTIMIZATION_BACKLOG.md)
- [產品與技術決策紀錄](docs/DECISIONS.md)
- [開發紀錄](docs/DEVLOG.md)
- [Demo 與測試計畫](docs/DEMO_TEST_PLAN.md)
- [第三方套件授權盤點](docs/THIRD_PARTY_LICENSES.md)
- [來源、模型、資料與素材揭露](docs/SOURCES_AND_ATTRIBUTIONS.md)
- [公開儲存庫交付檢查](docs/PUBLIC_REPOSITORY_CHECKLIST.md)
- [規則庫草案](rules/official-rules.v1.yaml)
- Demo素材：本機外部`%USERPROFILE%\RentProof-Demo\cases\golden-v1`（不屬於repository；18個檔案已由manifest＋SHA-256封存）

## 本機開發

目前鎖定Node.js 24.20.0 LTS、pnpm 11.25.0、Next.js 16.3.4與TypeScript 6.0.3。第一次安裝與驗證：

```powershell
pnpm install --frozen-lockfile
pnpm env:check
pnpm demo:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm security:check
pnpm build
pnpm test:e2e
```

`pnpm test:e2e`驗證Formal Demo的Production Build，因此必須先成功執行`pnpm build`。
`pnpm env:check`會離線比對`.node-version`、`packageManager`、`engines`與實際Node／pnpm版本；任何漂移都會fail closed。
`pnpm demo:check`是唯讀、離線優先的local Demo就緒檢查：驗證鎖版工具鏈、外部Golden seal／inventory、runtime root、synthetic profile、port、self-hosted Auth／PostgreSQL設定狀態與OpenAI Project-limit警告，不登入provider、不顯示secret，也不修改環境。LAN使用`pnpm demo:check -- --profile=lan`；只有requested profile的`BLOCKED`會令指令回傳非零，`WARN`只保留明確風險。

PostgreSQL migration只能由獨立命令執行，Web process不會自動升級schema。Repository另提供Windows listener fail-closed檢查、無密碼bootstrap／finalize SQL與migration／app readiness。完整步驟見 [PostgreSQL Synthetic Demo操作手冊](docs/POSTGRES_DEMO_RUNBOOK.md)。執行前必須另外提供local-only資料庫、分離角色與session限定的完整環境設定：

```powershell
pnpm db:listener:check -- 5433
pnpm db:check -- migration
pnpm db:migrate -- up
pnpm db:check -- app
```

推薦的隔離Synthetic PostgreSQL 18流程與self-hosted Auth loopback啟動由同一個user-owned manager處理；migration仍需明確同意後才執行：

```powershell
pnpm db:demo -- Initialize
pnpm db:demo -- Start
pnpm db:demo -- Provision
pnpm db:demo -- MigrationReadiness
pnpm db:demo -- Migrate
pnpm db:demo -- Finalize
pnpm db:demo -- Readiness
pnpm db:demo -- Smoke
pnpm build
pnpm auth:demo -- StartAuthDemo
pnpm auth:demo -- AuthHttpSmoke
```

Auth Demo固定只在`http://127.0.0.1:3000`使用Synthetic資料與Fixture LLM。結束時先執行`pnpm auth:demo -- StopAuthDemo`，再視需要停止PostgreSQL；LAN HTTP仍不開放帳戶密碼或session。完整Gate見[PostgreSQL Demo操作手冊](docs/POSTGRES_DEMO_RUNBOOK.md)。

目前電腦另有不符合RentProof要求的既有PostgreSQL listener，RentProof不使用或修改它。獨立的user-owned PostgreSQL 18 Synthetic Demo cluster已在`127.0.0.1:55432`完成初始化；`rentproof_demo`、NOLOGIN owner、分離migration／app roles、`001_initial_real_data_schema`與`002_self_hosted_auth`、ACL finalization、12-table readiness、owner隔離／CAS／cleanup及Auth HTTP smoke均已驗證。Credential只存在受ACL保護的外部Demo環境檔，Web process不會自動migration。這套環境仍只允許虛構Demo資料。

OpenAI雙模型Live smoke是付費、明確opt-in的操作；一般啟動與CI不會執行。只有完成Project額度／速率設定後，才同時設定`RENTPROOF_LLM_MODE=live`、`RENTPROOF_LIVE_SMOKE=1`並執行：

```powershell
pnpm eval:live -- --live
```

輸出僅包含模型、狀態、requested／resolved tier、usage數字與reason code，不輸出API key或request／response文字。

日常本機啟動：

```powershell
pnpm dev
```

預設`synthetic`模式不組裝帳戶runtime。若要建立loopback-only self-hosted Auth Demo，build與start必須同時使用`RENTPROOF_AUTH_MODE=self_hosted`、local-only PostgreSQL app role及私密`RENTPROOF_AUTH_TOKEN_KEY`；該key為32隨機bytes的base64url，只放受ACL保護的外部Demo環境檔，不進repository、browser或log。缺少、不精確或在LAN profile出現時Build／啟動皆fail closed。

Loopback Demo使用只存在記憶體且綁pre-auth browser context的synthetic信箱；可人工輸入43字元一次性Email驗證／重設code。LAN Auth routes固定disabled；真正寄信前仍須重新決定Transactional Email provider、處理地區與DPA。

私人LAN使用獨立的忽略檔`.env.lan.local`與安全Gate：`pnpm dev:lan`或Formal Demo的`pnpm start:lan`。2026-09-03環境驗證時，Wi-Fi為Windows Private profile、LAN IP為`172.16.102.98`；精確Firewall rule已安裝並完成enable／disable／scope驗證，Fixture Production Build也已在該位址完成allowed Host 200、wrong Host 400與Forwarded attack 400 smoke。這是已完成的環境驗證紀錄，不保證程序或Firewall目前仍在運行；每次展示前仍須重新檢查狀態、逐次確認無port forwarding／UPnP／tunnel，結束後停用rule。

Next全域Proxy會在auth與所有頁面／API／靜態資產之前檢查exact Host；安全GET不強制Origin，mutation仍由各Route要求exact Origin＋CSRF。Missing／multiple／malformed／非allowlist Host、`Forwarded`、forwarded chain或host／proto／port mismatch會直接回不含環境資訊的4xx；核對後所有forwarded metadata都會從送往Application的headers移除。

Firewall操作入口只讀取`.env.lan.local`的精確RFC1918 IP／port及目前鎖定的`node.exe`，每次會顯示UAC；不接受CLI覆寫host／port，也不啟動Node。首次只安裝disabled規則，Demo前短暫enable，結束後立即disable並verify：

```powershell
pnpm lan:firewall:install-disabled
pnpm lan:firewall:verify
pnpm lan:firewall:enable
# 另行逐次確認無port forwarding、UPnP exposure與tunnel，再啟動LAN Demo。
pnpm lan:firewall:disable
pnpm lan:firewall:verify
```

UAC取消、逾時、權限拒絕、scope不符及驗證失敗皆回typed blocker；結果透過validated runtime內的單次檔案回傳，讀取後立即刪除。這些命令不會自動設定三個`RENTPROOF_LAN_NO_*`逐次assertion。

若在Codex AppContainer內執行時看到`LAN_FIREWALL_EXTERNAL_TERMINAL_REQUIRED`，代表Windows把預設`LOCALAPPDATA` canonical path投影到Codex package `LocalCache`；安全檢查不會放寬或把該投影誤當成正式runtime。請在一般、非Codex內建的PowerShell終端切到本repository，再重跑同一個`pnpm lan:firewall:*`命令並處理UAC。

Playwright Chromium只需在新環境安裝一次：`pnpm exec playwright install chromium`。Repository的`.env.example`保留安全預設與空白secret；實際`.env.local`不提交，文件不假定其中是否已配置key。LAN Firewall安裝／查核／啟用／停用腳本位於`scripts/windows/`；本機listener／Host／Forwarded／Firewall smoke已完成，另一台實體LAN裝置的連線、RWD與人工accessibility smoke仍需在明確Private網路及受控Firewall規則下執行。

## 限制與明確不做

全台租屋搜尋、任意網站爬取、自動聯絡房東、付款或簽約、信用評分、臉部辨識、結構安全判定、地政／戶籍／私人身分資料串接，以及搬入／搬出責任歸屬，均不在 P0 MVP 內。SMS與真實資料上傳仍未開啟；self-hosted Auth／PostgreSQL目前只完成Demo-safe、feature-gated切片，不代表通過真實資料Gate。

## 下一個開發動作

P0程式、Fixture、OpenAI雙模型Live smoke、PostgreSQL migrations／readiness／synthetic smoke及self-hosted Auth loopback整合均已完成。下一步只剩外部或人工Gate：在OpenAI Development Project核對成本／速率限制、用另一台實體裝置完成LAN RWD／keyboard／200% zoom／screen-reader smoke，以及選定Transactional Email provider。三份政策仍是DRAFT；Production OS、正式憑證、off-host backup與台灣法務／隱私審閱完成前，不接受或宣稱支援真實資料。任何更動三態語意、安全邊界或官方規則判讀方式的決策，都要同步寫入[決策紀錄](docs/DECISIONS.md)。
