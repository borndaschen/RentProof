# RentProof 開發紀錄

本檔記錄已完成的事實與驗證，不把規劃中的工作寫成已完成。最新紀錄放最上方。

## 2026-09-04 — 全域安全、效能、除錯、UI／UX與程式收斂

### 已完成

- 安全：CSP新增`script-src-attr 'none'`，全站補Cross-Origin-Opener／Resource Policy及禁止cross-domain policy；新增行為測試。Real case、Guest與補貼API改用共用`private, no-store`＋nosniff response helper，移除各route重複實作。
- 安全／效能：Auth rate limiter新增過期counter清理、10,000-scope容量上限、無效時間／空scope fail-closed及時鐘倒退bounded retry，並改用TLS proxy驗證後的來源IP＋session／pre-auth／reset token雜湊雙層bucket，避免全站共用host bucket與長時間process記憶體無界成長。外部來源不得注入內部IP header；TLS與Next proxy間仍重驗單一IP及proxy marker。
- 安全／效能：PII acknowledgement store加入10,000筆硬上限、TTL後10分鐘typed reason保留及清理；conversation completed-turn與pending-listing maps改用可測試的10,000筆expiring bounded map。容量滿載不驅逐live紀錄，而以typed 503 fail closed。
- 效能／精簡：補貼Client不再載入Zod與Domain runtime，改為Server唯一strict schema＋Client最小display projection。Next route bundle統計的`/rent-subsidy`首載未壓縮JS由857,011降至480,456 bytes，減少376,555 bytes（44.0%）。History list／detail亦移除Client Zod/application runtime，首載分別由850,551／849,844降至467,999／467,606 bytes，約減少45.0%。
- 除錯／UX：補貼Client區分來源過期typed 503與一般錯誤，顯示「官方資料待更新」；拒絕重複criterion／source、非官方URL或錯誤版本。結果與明細使用初步相符／有待確認／資料不足三種不同語意線，不再全部呈現成功色。
- 效能：History list、History detail與Real Data首頁的初始fetch在元件卸載時會Abort，並明確使用same-origin credentials／no-store，避免離頁後仍保留不必要request。
- 自然語言：一般頁面移除Fixture、Golden、Synthetic、Server、Client、Snapshot、Manifest、schema及Project等工程詞；內部claim／status／reason不直接顯示，改為「洗衣機承諾」「有項目待確認」等租屋者可理解文字。PII warning只把allowlisted code映射成中文類型，未知code不回顯。

### 驗證

- 最終Coverage為149 files／1,391 tests通過；statements 85.64%、branches 80.79%、functions 89.74%、lines 88.46%。安全／記憶體／來源IP／自然語言／UI聚焦回歸另有11 files／112 tests及多組agent獨立測試通過。
- Prettier、TypeScript、ESLint、612-file Security Gate及Next Production Build通過，並以route bundle stats量測上述差異。
- Playwright desktop／mobile為25 passed／3個既有mobile singleton mutation案例依設計skip；包含補貼360 px、axe、結果焦點、自然語言確認與既有報告／網路邊界流程。
- `pnpm audit --prod`已嘗試，但npm registry advisories endpoint三次皆timeout；不得把外部查核失敗記成零漏洞。Repository Security Gate與完整測試仍由最終Gate執行。

### 尚未完成／風險

- Production dependency advisory仍需在registry恢復後重跑；本次保留明確外部查核失敗紀錄。
- CSP仍需Next.js inline bootstrap相容性而保留`script-src 'unsafe-inline'`；本次以禁止script attribute、cross-origin isolation與既有無raw HTML控制縮小風險。若未來導入request nonce，必須先完成Next App Router production hydration與LAN E2E。

---

## 2026-09-04 — README依作品模板重整

### 已完成

- 依指定模板重整README為問題與目標、核心功能、系統架構、使用技術、安裝與執行、作品展示、限制與未來工作、第三方服務／資料／素材、團隊成員及License。
- 依目前實作補入租金補貼預檢、對話式證據流程、OpenAI模型分工、PostgreSQL／私有素材、LAN HTTPS與正式上線缺口；未把政策草案或展示環境描述為正式上線。
- 團隊成員表依使用者要求保留空白，不推測姓名或分工。

### 驗證

- 指令／測試：`pnpm format:check -- README.md docs/DEVLOG.md`；本機Markdown連結存在性檢查；`git diff --check`。
- 結果：格式、README本機連結與diff whitespace檢查均通過。

### 決策與偏差

- 未新增產品或架構決策；只重整公開說明的資訊架構與文字。

### 尚未完成／風險

- 公開作品展示網址與評選影片仍待提供；README保留明確待補狀態。

### 下一步

1. 由團隊自行填寫成員姓名、分工及評選影片連結。

---

## 2026-09-04 — 115年度租金補貼申請條件預檢

### 已完成

- 新增獨立`/rent-subsidy`頁面，以8組可鍵盤操作的問題涵蓋115年度新申請的15項條件檢核；兩種首頁均提供入口，不增加第五個Evidence Workspace分頁，也不把RP-010契約限制與申請人條件混成同一結果。
- 新增strict Zod輸入／結果schema、22縣市門檻表及`evaluateRentalSubsidyPrecheck115`確定性evaluator。結果限`preliminary_match／needs_review／insufficient_information`，任一待確認優先，其次資料不足；不輸出合格／不合格或政府核定結論。
- 新增same-origin、4 KiB bounded strict JSON、forwarded-header防護與`private, no-store`的`POST /api/rent-subsidy/precheck`。Client只驗證／呈現Server結果，不自行計算條件。
- 最小資料設計不收精確所得，只收是否低於畫面所列門檻的自我確認；不要求姓名、身分證、詳細地址、戶籍／所得／財產／權狀或弱勢證明，不使用browser storage、OpenAI或其他外部provider。
- 新增版本化DRAFT規則檔、官方來源／年度更新規格與D-098；跨年度不得fallback。2026-09-04五個官方頁面已建立本機受控快照，manifest記錄URL、bytes、內容驗證與SHA-256；兩個primary hash隨預檢結果保存。Server在查核日位於未來、時鐘無效或超過31日時fail closed。
- 完成工程／產品內部法律、隱私與規則治理審閱矩陣，逐項記錄政府資格誤認、資料最小化、告知、目的限制、權利、保存、安全、第三方、來源及年度更新控制；明確保留獨立台灣法律／隱私專業簽核，不將內部審閱冒充法律意見。
- 新增`subsidy:sources:check`離線／Live唯讀來源檢查，以及`subsidy:year:scaffold`未來年度草案工具。Live檢查對固定官方host驗HTTP、MIME、1 MiB、sentinel與hash；年度草案以exclusive create建立空來源、空threshold、空rules且`productionReady: false`，不複製115年值。
- 依repository擁有者要求，補貼查核排程不保存在ChatGPT／Codex task。先前建立的heartbeat已刪除；repository只提供可由外部OS／CI scheduler呼叫的唯讀指令，實際排程器與執行身分須由部署環境另行設定。

### 驗證

- 最終聚焦稽核包含UI／API 5 files／97 tests及來源／年度治理4 files／28 tests；涵蓋Subsidy門檻、unknown、例外、schema、禁止結論、source freshness、manifest semantic hash、bounded redirect、年度no-fallback與API／UI fail-closed。Live官方來源檢查5／5通過。
- 完整Coverage：145 files／1,365 tests通過；statements 85.46%、branches 80.43%、functions 89.57%、lines 88.28%。首次並行執行有4個既有PowerShell／PostgreSQL／History測試逾時，單獨32 tests全數通過，將完整test timeout調為30秒後全數通過。
- Prettier、TypeScript、ESLint、606-file Security Gate及Next.js Production Build通過。
- Playwright desktop／mobile：23 passed／3個既有mobile singleton mutation案例依設計skip；新增預檢E2E兩種viewport均通過API、15項結果、no-store、無水平溢位與axe檢查。

### 尚未完成／風險

- 內部工程／產品／規則治理審閱已完成；仍需具名台灣法律／隱私專業簽核，以及正式營運者名稱、聯絡方式、利用地區、權利管道與實際處理依據，因此規則內容與介面維持DRAFT／預檢語意，不能標示正式資格認定或Production-ready。
- 補貼級別、核定金額及加碼倍數不在第一版範圍；來源超過31日或hash異動時需重新人工查核、建立新snapshot並更新規則版本。

## 2026-09-03 — D-097 六位數字Email驗證碼與登入診斷

### 已完成

- 依repository擁有者要求，`AGENTS.md`改為僅保留於本機：加入`.gitignore`並從Git index移除；未改寫既有公開Git歷史。
- 記錄CSPRNG 6位ASCII數字碼、15分鐘TTL、單次consume、最多5次attempt、server-keyed HMAC digest、rate／resend limit與minimum response floor。
- 明確保留32-byte CSPRNG opaque account session token；同步更新Auth、Security、Technical Design與隱私草案（政策仍為DRAFT）。
- 新增domain-separated HMAC數字碼service；註冊驗證與密碼重設改用`000000`至`999999`，UI固定`inputmode=numeric`、6位pattern及one-time-code autocomplete。Account／Guest Session、CSRF與pre-auth token仍維持原本256-bit opaque格式。
- HTTPS Production Build已重新啟動。唯讀資料庫診斷確認操作者指定帳號存在、啟用且Email已驗證；未讀取或輸出密碼hash。登入失敗不屬帳號缺失，應使用正確的12–128字元既有密碼，或以新6位碼完成密碼重設。
- Gmail模式的註冊／重設流程改為直接提示查看Email中的6位數碼，且不再顯示僅適用synthetic模式、會導向404的帳戶驗證中心連結；重設要求已由使用者明確確認後建立，最終新密碼與驗證碼仍由使用者自行輸入及送出。

### 驗證

- `pnpm test:coverage`：138 files／1,253 tests通過；statements 85.17%、branches 80.05%、functions 89.33%、lines 87.99%。
- Production Build、Prettier、ESLint、TypeScript及573-file Security Gate通過。
- Playwright desktop／mobile為21 passed／3個既有mobile singleton mutation案例依設計skip。

### 尚未完成／風險

- Gmail連線先前已完成實寄；密碼重設要求已接受，但基於認證資料安全，未代替使用者讀取Email、輸入驗證碼或送出新密碼。
- 正式Email配額／退信監控、資料地區確認與法務／隱私審閱仍是Gate。

## 2026-09-03 — Guest保存、Retention Worker與個人Gmail寄送邊界

### 已完成

- Guest案件可在同一瀏覽器同時持有有效guest session與最近15分鐘account session時，經明確「保存此案件」操作原子轉移；PostgreSQL同一transaction鎖定兩種session、case與artifacts，更新owner、增加revision並寫入最小audit event。跨owner、過期、撤銷、未reverify與重播分開fail closed。
- 登入建立的session視為最近驗證，`reverified_until`固定15分鐘；Guest UI以新分頁登入保留原工作階段，再由原頁發出CSRF／Origin保護的明確transfer。
- 新增可重試retention purge service、PostgreSQL claim／complete／fail adapter與明確opt-in CLI。流程先刪除repository外加密案件目錄，再原子清除到期guest或case／account內容；完成tombstone保存21天，security audit保存180天。
- Production raw conversation persistence尚未啟用，因此worker明確回報0筆raw text，不會誤刪typed case state；未來啟用raw text table時須先新增7日target與24小時purge測試。
- 依D-095新增個人Gmail API adapter：server-only OAuth refresh token、最小`gmail.send`用途、固定MIME範本、bounded response、10秒timeout及stable failure。Fixture／local synthetic outbox不組裝Gmail，Gmail secrets出現在未啟用profile時fail closed；synthetic mailbox僅在明確`local_synthetic`模式開放並持續綁定同瀏覽器pre-auth context。
- 個人Gmail OAuth設定已在受ACL保護的secure-LAN env完成形狀驗證；獨立explicit-opt-in smoke寄出一封不含驗證碼、密碼或租屋資料的連線測試信至操作者指定信箱，CLI只輸出`GMAIL_SMOKE_SENT`。首次執行發現Node 24 strip-only不支援parameter property，修正adapter建構式後成功重試。
- 新增Screen Reader人工驗收清單；自動axe／Playwright不得取代人工Narrator結果。
- 依D-096將真實資料首頁改為單一自由文字composer，移除逐步表單卡作為主要輸入；同一輪可同時送出自然語言與附件，文字安全辨識成功後才開始upload，避免附件在文字hard block時部分成功。
- Conversation route加入8 KiB／2,000 code-point限制、strict JSON、auth-secret hard block、一般PII一次性ack、actor／IP rate limit、per-case concurrency、opaque idempotency與payload-hash binding。Prompt injection文字只能成為inert note，不能指定stage、結果或跳過owner／confirmation Gate。
- 公開租屋網址採Server exact-host allowlist、HTTPS 443、每次redirect重驗、DNS public-address檢查及IP-pinned TLS socket，拒絕userinfo／fragment、private／reserved addresses、非HTML、超過1 MiB、非UTF-8與timeout。擷取結果需在10分鐘內以自然語言再次確認，才以revision CAS加入案件並作為listing text送入既有Terra schema／locator流程。
- 依實際畫面回饋調整桌面版為對話主欄＋sticky案件摘要，移除厚重訊息卡；Header只顯示具按鈕外觀的「登入」。Auth政策連結改為藍色底線超連結；驗證中心的顯示驗證碼與返回改為明確主／次按鈕，並修正HTTPS LAN synthetic mailbox前後端Gate不一致。

### 尚待外部完成

- Gmail連線已實寄成功；正式寄送仍需持續監控配額、退信與帳號風控，不保存Gmail密碼或App Password。
- 使用者在對話提供的密碼不符合12–128字元政策且屬auth secret，未寫入任何檔案、命令、log或OpenAI request。帳號建立需由使用者在頁面自行輸入新的合規密碼。
- 尚未指定真實素材檔案，故未執行OpenAI逐檔外送或產生費用。
- Screen Reader仍待人工執行；政策仍缺營運者法定資訊並待台灣法務／隱私專業審閱，持續為DRAFT。

### 驗證

- `pnpm test:coverage`：137 files／1,242 tests通過；statements 85.16%、branches 80.02%、functions 89.30%、lines 87.99%，全域門檻通過。
- Prettier、TypeScript、ESLint、570-file Security Gate及Production Build通過；Playwright desktop／mobile為21 passed／3個既有mobile singleton mutation案例依設計skip。

---

## 2026-09-03 — 全文件現況稽核

### 已完成

- 逐份核對README與22份產品、架構、Server、UI、技術、OpenAI、安全、Auth、政策、規則、測試、資料庫、授權及交付文件，使其與目前程式及實機環境一致。
- 現行文件統一為本機HTTP loopback、LAN HTTPS 3443、內部Next.js 3100、四份migration、14張產品資料表、訪客24小時固定Session、帳戶7天滑動Session、owner-scoped加密素材與conversation-first入口。
- 公開閱讀文件不再使用P0／P1工程階段代號，改為「目前／後續」、「基本6條／完整10條」；README維持精簡GitHub格式。
- 移除舊HTTP LAN profile、舊啟動／Firewall命令、舊環境檔、12／13 table、登入才能使用、LAN禁止真實資料及HTTP警告等過時說明。
- 新增D-094並把D-002的「聊天不是主畫面」標為部分被取代；DECISIONS／DEVLOG保留歷史文字，但現行狀態與被取代關係清楚標示。
- 隱私政策、使用條款、Cookie政策與OpenAI處理告知仍維持DRAFT；未捏造營運者、聯絡方式、處理地區、未成年人、爭議條款或法務審閱結果。

### 驗證

- Active docs過時詞掃描為零；本機Markdown links全部存在。
- Prettier與545-file Security Gate通過；本次只更動文件與AGENTS現況說明，程式測試沿用上一筆128 files／1,166 tests完整通過結果。

---

## 2026-09-03 — 訪客入口、對話式案件頁與資料庫第四版

### 已完成

- 未登入使用者可從同一首頁直接取得私有訪客工作階段並建立案件，不需先進入註冊頁；登入仍是保存與跨裝置查詢歷史的選項。
- 訪客工作階段使用獨立opaque Cookie與server-keyed HMAC digest，自建立起固定24小時且不因操作延長；案件與素材仍逐次執行guest／user owner scope。
- 新增凍結、版本化的`004_guest_sessions` Kysely migration，資料庫constraint限制到期時間不得超過建立後24小時；Web process與request仍不得自動執行migration。
- 私有素材頁採對話式引導語氣，依序完成建立案件、加入廣告／看屋照片／租約、執行分析、查看待確認事項與刪除案件；訪客與帳戶使用相同入口。
- 公開README與帳戶文件已同步目前訪客／登入差異、migration狀態與政策缺口；主要使用者說明不再以工程階段代號描述功能。

### 驗證

- 完整Coverage為128 files／1,166 tests通過；statements 85.02%、branches 80.34%、functions 88.66%、lines 87.62%。
- Prettier、ESLint、TypeScript與545-file Security Gate通過；Production Build成功，Playwright desktop／mobile為21 passed／3個既有mobile singleton mutation案例依設計skip。
- HTTPS與本機資料庫皆已明確套用四份migration並通過14-table readiness。實機訪客完成建立與刪除案件；案件與素材aggregate均為0。測試建立的一筆無案件訪客session保留至固定24小時到期，未為清理測試而擴大刪除其他訪客範圍。

### 尚未完成／風險

- `004_guest_sessions`已由獨立migration操作套用至HTTPS與本機資料庫，兩者14-table readiness皆通過；Web啟動與request仍不會自動執行migration。
- 三份政策仍為`DRAFT`，缺少營運者法定資訊、聯絡方式、未成年人、處理地區、爭議條款及台灣法務／隱私審閱，不得宣稱正式生效。

---

## 2026-09-03 — HTTPS真實素材Demo完成

### 已完成

- 建立並信任專用本機CA；Server憑證固定SAN `172.16.102.98`／`127.0.0.1`／`localhost`，私鑰只存於repository外且由NTFS ACL限制。
- 新增`lan_secure_demo`：外部只監聽`https://172.16.102.98:3443`，Next.js只監聽`127.0.0.1:3100`；移除舊HTTP LAN啟動入口、3000 listener與Firewall規則。
- 實作self-hosted Auth、Secure／HttpOnly／SameSite Cookie、內部TLS Proxy高熵標記、exact Host／Origin、CSRF與forwarded-header拒絕。
- 新增隔離的`rentproof_secure_demo`資料庫、分離migration／app roles及`003_private_case_artifacts`；原檔名不進DB，圖片先由Sharp移除metadata，PDF先由PDF.js建立可定位文字。
- 素材以AES-256-GCM v2加密保存於repository外私有目錄，AAD綁定案件相對路徑；所有artifact／case／analysis／delete query皆owner-scoped。刪除案件後立即停止存取並同步清除加密檔與線上案件內容，失敗保持待清除狀態供安全重試。
- 真實素材分析入口已接OpenAI Terra三個固定抽取階段、案件Budget、schema／locator驗證、三態比較及Server snapshot；只有Live、已確認Project額度與Server-only Key同時成立時啟用。
- 使用者可見頁面改為一般租屋者語氣，移除Demo／Fixture／Golden／P0／P1／Synthetic等工程字樣；返回連結統一為「返回」，並補強鍵盤焦點、窄螢幕與200%縮放。

### 實機驗證

- HTTPS首頁200，HSTS、no-store與nosniff存在；wrong Host回400。實際listeners只有`172.16.102.98:3443`及`127.0.0.1:3100`，3000為零。
- PostgreSQL migrations 001／002／003與13-table App readiness通過；DB只監聽loopback。
- 一次性測試帳戶完成註冊、驗證、登入、建立案件、AES-GCM圖片上傳、刪除與帳戶清理，確認零殘留。
- OpenAI Project額度由操作者確認並已配置Live Gate；實際3-stage付費外送測試因缺少對指定檔案的逐次外送授權而未執行，沒有發出Provider request或產生本次費用。

### 自動化驗證

- Vitest Coverage：125 files／1,154 tests通過；statements 85.00%、branches 80.23%、functions 88.82%、lines 87.62%。
- Production Build、Prettier、ESLint、TypeScript與538-file Security Gate通過。
- Playwright：desktop／mobile Chromium共21 passed、3個既有mobile singleton mutation案例依設計skip。

### 仍需外部完成

- 其他LAN裝置需各自安裝公開CA憑證後才能無警告連線。
- 政策仍缺營運者法定資訊、聯絡方式、未成年人、處理地區、爭議條款及台灣法務／隱私審閱，因此維持DRAFT，不虛稱正式生效。

---

## 2026-09-03 — HTTP LAN退役與公開文件整理

### 已完成

- 新增D-093：HTTP只保留`127.0.0.1`本機開發；LAN統一使用`lan_secure_demo` HTTPS。
- 移除公開指引中的`dev:lan`、`start:lan`、`.env.lan.local`與`--profile=lan`可執行說明；Demo readiness只接受local profile。
- README改為一般GitHub讀者可快速理解的問題、功能、架構、技術、執行方式、安全限制及授權說明。
- 隱私政策、使用條款及Cookie政策維持DRAFT，並集中列出營運者法定資訊、聯絡方式、未成年人、處理地區、爭議處理與法務／隱私審閱缺口。
- 操作者已確認OpenAI Project額度設定；Live runtime仍須由啟動環境明確設定`OPENAI_PROJECT_LIMITS_CONFIRMED=true`。

### 驗證

- 舊`lan_development`仍由Server環境schema拒絕；沒有新增HTTP LAN fallback。
- 本次未執行Git。

### 尚未完成／風險

- 正式政策仍待營運者資料與台灣法務／隱私審閱，不得標示為已生效。

---

## 2026-09-03 — 公開GitHub repository交付Gate

### 已完成

- 建立並推送公開repository `https://github.com/borndaschen/RentProof`，預設分支為`main`；初始commit包含可執行的TypeScript／Next.js實作、測試、Apache-2.0 License與文件。
- README補齊問題、核心功能、架構與技術、執行方式及限制；新增`SOURCES_AND_ATTRIBUTIONS.md`與`PUBLIC_REPOSITORY_CHECKLIST.md`。
- 公開提交排除`.env.*`實值、credentials、憑證／私鑰、PostgreSQL、Runtime、uploads、Demo／真實素材、建置／測試產物及完整官方HTML／PDF快照；官方來源只留URL、SHA-256與規則metadata。
- 移除文件中的本機Windows使用者名稱與絕對使用者路徑，改用`%USERPROFILE%`、`%LOCALAPPDATA%`或泛用範例。

### 驗證

- 446個staged檔案的禁止路徑、private-key／常見credential pattern、大於1MiB檔案及個人使用者路徑掃描皆為零；`pnpm security:check`為510 files passed。
- 最終Build、Prettier、ESLint與TypeScript通過；文案變更的2個Vitest files／20 tests通過。
- 不帶GitHub登入資訊的公開HTTP請求確認repository、README、LICENSE與`src`皆回200；GitHub API確認`visibility=public`、`private=false`。

---

## 2026-09-03 — LAN Firewall UAC恢復與Fixture重啟

### 已完成

- 經UAC以受限管理腳本重新建立並啟用`RentProof-Lan-Development-Managed`；獨立Verify確認Inbound Allow只限Private profile、TCP、`172.16.102.98:3000`、`LocalSubnet`與`C:\Program Files\nodejs\node.exe`。
- 停止loopback Server，改以`lan_development`、Fixture、synthetic-only、synthetic auth、P0規則profile啟動於`http://172.16.102.98:3000`。

### 驗證

- LAN首頁200、runtime status為`fixture`／`synthetic_only`／`synthetic`／`p0`；錯誤Host回400，Auth頁回404。
- 本次未呼叫OpenAI、未使用真實資料、未執行Git，也未開啟wildcard bind、Public／Domain Firewall profile、Port Forwarding、UPnP或Tunnel。

---

## 2026-09-03 — 十條官方規則報告整合與自動化可用性收尾

### 已完成

- 新增 Server-only `RENTPROOF_RULE_PROFILE=p0|p1`，納入環境schema、validated launcher、readiness與安全runtime projection；缺省為P0，沒有Client／request覆寫入口。
- 集中定義P0六條、P1十條與中文名稱；Live snapshot及Client response schema只接受完整且與宣告Profile相符的集合。
- Golden報告預設維持六條；明確P1時加入RP-001／002／005／007，顯示中文名稱、官方HTTPS來源、條文定位與Server ActionCard行動。
- 新增Playwright browser Gate：Tabs鍵盤與可見焦點、axe、200% page scale、無水平頁面溢位、print media及非自然死亡資料不足區塊。

### 驗證

- Targeted Vitest：20 files／149 tests通過；完整`pnpm test:coverage`為118 files／1,110 tests通過，statements 86.09%、branches 81.22%、functions 89.56%、lines 88.43%。
- Production Build、TypeScript、ESLint、Prettier與508-file Security Gate全數通過。
- Playwright以Fixture Production Server完成desktop／mobile Chromium驗證：21 passed、3個既有mobile singleton mutation案例依設計skip；新增的鍵盤、axe、200%縮放、水平溢位、print與非自然死亡測試皆在兩種viewport通過。
- Browser axe曾實際抓到`.risk-note`深色文字疊深色警示底僅1.55:1；已改用`--warning-soft`淺色背景並由重跑E2E確認無違規。Windows coverage並行負載下PostgreSQL CLI graph首次超過Vitest預設5秒；只將該環境型測試外層上限調為15秒，原有exit code、typed error與module-load斷言不變，單獨及完整coverage重跑均通過。
- 最終本機Demo明確以Fixture／synthetic-only／synthetic auth／P0啟動於`http://127.0.0.1:3000`；首頁200、wrong Host 400。P1 readiness profile本身通過，但local runtime root因Codex filesystem virtualization被安全Gate阻擋，沒有繞過。
- 沒有呼叫OpenAI、沒有使用真實資料、沒有執行Git。

### 尚未完成／風險

- 另一台實體裝置的screen-reader smoke仍屬人工Gate。
- LAN專用Firewall規則唯讀檢查時已不存在；重新建立的UAC被使用者取消，因此沒有啟動LAN listener。需再次完成UAC後才能安全恢復`172.16.102.98:3000`。

---

## 2026-09-03 — P1 RP-005／RP-007 deterministic evaluators

### 已完成

- 新增`deposit_limit_and_return_v1`：以canonical TWD minor-unit字串及`BigInt`精確核對兩個月押金上限，不使用浮點數；押金返還／抵充約定缺漏時維持`missing_information`。
- 新增`non_metered_and_public_electricity_v1`：分開核對非按度收取總額與公共用電是否列入帳單；同一標的／同一期帳單、用電度數、租賃範圍或比較金額缺漏時一律`missing_information`。
- 兩條evaluator皆固定官方source ID、有效日期、strict schema、allowlisted rule/evaluator pair及stable reason codes；只有帶case locator的明確數值／文字差異才能產生`possible_difference`。
- P1 profile沿用2026-09-01凍結的`CURRENT_TERMS_PDF`與`ELECTRICITY_2024`來源；P0 active IDs及Golden結果不變。

### 驗證

- Targeted 2 files／31 tests通過，兩個新增evaluator皆達100% statements／branches／functions／lines coverage；全部official-rules regression為12 files／92 tests通過。測試涵蓋超過JavaScript安全整數範圍的精確比較、等於／低於上限、缺件、unknown／not-applicable applicability、日期Gate、wrong source、空locator、unknown key與非canonical數值。
- 未呼叫OpenAI、未使用網路、未修改外部Golden素材、未執行Git。
- 全域`pnpm typecheck`及相關檔案ESLint通過；全域格式Gate執行時另有並行P1 UI檔案尚在編輯，待root完成整合後統一重跑。

---

## 2026-09-03 — P1 RP-001／RP-002 deterministic evaluators

### 已完成

- 新增`review_period_v1`與`advertisement_exclusion_v1` allowlisted TypeScript evaluators，分別對應RP-001／RP-002；P0 active IDs與Golden輸出未變。
- RP-001明載審閱日數優先，否則只以ISO交付日與預定簽約日計算UTC日曆日；少於3日或可定位的放棄審閱語意回`possible_difference`。完整契約、至少3日且確認未出現放棄文字時才回`no_difference_found`。
- RP-002只有strict semantic extractor標示`present`且附`contract_text` locator時可回疑似差異；完整契約確認`not_present`才回未發現差異。
- 兩條規則對unknown applicability、pre-effective／非住宅scope、缺件、日期、語意改寫、locator、unknown key與state/value smuggling均fail closed並使用stable reason codes。

### 驗證

- Targeted 2 files／14 tests通過；新增來源全數沿用`CURRENT_TERMS_PDF`的本機凍結snapshot，未呼叫OpenAI、未使用網路、未修改Golden素材、未執行Git。
- TypeScript全域Gate執行時偵測到另一個並行P1 UI工作尚未補齊其`ruleProfile`測試fixture；本次新增domain檔案沒有TypeScript錯誤，待最終整合Gate由root統一重跑。

---

## 2026-09-03 — 非自然死亡揭露與最終LAN整合Gate

### 已完成

- 非自然死亡揭露已由契約專用strict extraction欄位接入locator／case／artifact／Unicode excerpt驗證、Server evaluator、Public Live Snapshot、PreSigningReport與可列印來源連結；Client不重新判斷。
- Golden case明確沒有相關簽署證據，因此兩個期間維持`insufficient_evidence`；located yes／no及同期間衝突由獨立測試覆蓋，傳聞、新聞、地址搜尋、listing或模型推論不能形成候選。
- 修正reporting locator未涵蓋的branch測試，不降低100%核心branch門檻；Vitest固定最多4 workers避免Windows Coverage高負載造成5秒假timeout，單項行為timeout門檻未放寬。
- 現行README、Implementation Plan、Optimization Backlog、Server Configuration與System Architecture已同步實際002 migration、Auth HTTP smoke、Firewall與LAN Host Gate狀態。
- Final Fixture Production Build重新啟動於`http://172.16.102.98:3000`；Firewall規則為Private／LocalSubnet／指定IP、port及Node，runtime為fixture／synthetic-only／synthetic auth。

### 驗證

- `pnpm test:coverage`：113 files／1,061 tests通過；statements 85.99%、branches 81.06%、functions 89.54%、lines 88.29%，所有module/global thresholds通過。
- `pnpm build`、format、ESLint、TypeScript與497-file Security Gate通過；Fixture Production E2E 15 passed／3 intentional mobile singleton mutation skips。
- 最終LAN smoke：首頁200、wrong Host 400、Auth page 404；未使用真實資料、未呼叫OpenAI、未執行Git。

### 外部／人工Gate

- 仍需由另一台實體LAN裝置完成人工RWD、keyboard、200% zoom與screen-reader smoke；OpenAI Dashboard limits、Transactional Email、Production storage／backup／purge及政策法務Gate不屬本次Synthetic Demo完成宣告。

---

## 2026-09-03 — 非自然死亡揭露契約分析接線

### 已完成

- 將Terra契約輸出升為`contract.extract.prompt.v2`／`rentproof.terra-analysis.v2`，新增獨立strict `nonNaturalDeathDisclosureStatements`，未挪用一般契約semantic key或自由文字。
- Provider schema只允許契約條款與已簽住宅租賃現況確認書，固定專有部分、兩個期間、yes／no／unknown、明示事件類型、簽署狀態及PDF locator；傳聞、新聞、地址搜尋、listing與模型推論無法表示成候選。
- Adapter驗證case／artifact ownership、PDF page與Unicode code-point excerpt逐字相符後，才移除provider envelope欄位並映射domain statement；錯誤維持schema invalid與locator invalid分流。
- Live deterministic compose執行既有領域evaluator，Public snapshot只暴露`nonNaturalDeathDisclosure`中立核對結果與source locators，不暴露未裁決provider候選。

### 驗證

- 未呼叫OpenAI、未修改sealed Golden素材、未執行Git。
- Targeted adapter／Live service測試涵蓋安全來源映射、排除傳聞／新聞／地址搜尋／模型推論、scope、signed flag、cross-case／artifact與逐字locator，以及兩期間server-evaluated snapshot。

### 尚未完成／下一步

- 報告元件接線與完整品質Gate由同一整合工作統一完成。

---

## 2026-09-03 — 非自然死亡揭露進入報告資料模型

### 已完成

- `PreSigningReportInput`新增strict、schema-validated的`nonNaturalDeathDisclosureStatements`；Report Composer只在Server／Domain邊界呼叫deterministic evaluator，輸出first-class `nonNaturalDeathDisclosure`結果。
- 每筆揭露陳述的locator必須與報告已註冊來源完整相符；未註冊或內容不一致會fail closed，不會把傳聞、搜尋、新聞或模型推測轉成肯定結果。
- `ReportDocument`移除硬編碼空陳述與client-side重新判斷，改為純顯示report field；兩個期間的located yes／no／conflict結果可透過既有受控Demo artifact endpoint顯示來源連結。
- Golden報告與整合測試明確提供空陳述，維持兩個期間皆`insufficient_evidence`及既有action排序／數量。

### 驗證

- Report composer、Disclosure section、Report document與Golden integration共4個targeted files／21 tests通過。
- `pnpm typecheck`通過；`pnpm format`完成且相關檔案無格式漂移。
- 測試涵蓋located yes／no、同期間yes／no conflict、空Golden、未註冊locator、列印UI來源連結與禁止物件判決／機率／責任文字。
- 未呼叫OpenAI、未使用真實資料、未執行Git。

### 尚未完成／下一步

- 完整coverage／lint／build／E2E與Live pipeline整合由最終整合Gate統一重跑。

---

## 2026-09-03 — 最終Demo環境、Self-hosted Auth與LAN實機閉環

### 已完成

- 使用者明確批准後，user-owned PostgreSQL 18 synthetic cluster實際套用`001_initial_real_data_schema`與`002_self_hosted_auth`；Finalize、12-table app readiness、owner／CAS DB smoke均通過且零殘留。
- 捨棄Clerk active runtime與dependency，完成Argon2id Email／密碼Auth、Email驗證、登入／登出、密碼重設、browser-bound localhost outbox、7天滑動Session、reverification token rotation與owner-scoped history。
- 實際Auth HTTP＋DB smoke完成register→verification mailbox→verify→login→passive no-slide→history slide→logout→reset→replay denial；最後`AUTH_HTTP_SYNTHETIC_RESIDUE_ZERO`。
- LAN首次實機smoke發現錯誤Host仍回200；新增全域Host／Forwarded Proxy boundary後，Fresh Build驗證allowed Host 200、wrong Host 400、Forwarded attack 400。Firewall規則經UAC建立並限制Private／LocalSubnet／`172.16.102.98:3000`／`node.exe`。
- 最終LAN Fixture Production Build已啟動於`http://172.16.102.98:3000`；runtime為fixture／lan_development／synthetic_only／synthetic auth，Auth page與API在LAN固定404。
- 新增非自然死亡揭露核對：兩個期間、專有部分、明確yes／no／unknown與locator；傳聞、地址搜尋、新聞與模型推測不形成肯定事實，不輸出俗稱「凶宅」判決。
- Repository授權最終改為Apache License 2.0，包含`LICENSE`與`NOTICE`；Security Gate強制驗證license內容、NOTICE、`package.json.license`與`private:true`。

### 驗證

- 完整Vitest Coverage：113 files／1,045 tests通過；statements 85.97%、branches 81.02%、functions 89.41%、lines 88.27%，所有global／module thresholds通過。
- Fixture Production E2E：Desktop／Mobile 15 passed、3 intentional mobile singleton mutation skips；包含實際Host與Forwarded攻擊回歸。
- `pnpm build`、format、ESLint、TypeScript、496-file Security Gate、frozen install與Production dependency audit通過；無production source map、無Clerk SDK marker或active import。
- `argon2@0.45.1`原生build與OWASP最低Argon2id參數實測通過；修正實際PHC參數順序`m,p,t`後，以順序無關解析再次驗最低值。
- 未使用真實租屋資料、未呼叫OpenAI、未執行Git。另一台LAN裝置的人工連線／200% zoom／screen-reader smoke仍需現場操作人員完成。

### 目前運行狀態

- LAN Fixture App與loopback PostgreSQL cluster目前運行中；Firewall規則目前啟用。Demo結束後必須先停止App，再以UAC執行`pnpm lan:firewall:disable`，最後視需要停止PostgreSQL cluster。

---

## 2026-09-03 — D-090 Apache-2.0 Security Gate

### 已完成

- 將舊有「任何LICENSE皆拒絕」規則改為強制讀取根目錄`LICENSE`，並依序驗證Apache License 2.0標題、版本、官方URL、九個條款標題、結尾與附錄標記。
- 強制根目錄`NOTICE`包含RentProof、`Copyright 2026 borndaschen`、contributors與第三方授權聲明。
- 強制`package.json`可解析且同時設定`license: "Apache-2.0"`與`private: true`；遺失、不可讀、錯誤授權或非private皆fail closed。
- 額外或改名的`LICENSE.*`／`COPYING*`仍以`LICENSE_FILE_AMBIGUOUS`拒絕，避免多份授權文件造成歧義。

### 驗證

- Security Gate測試涵蓋有效Apache組合、LICENSE遺失、條款遭竄改、MIT文字、錯誤package metadata、NOTICE遺失與額外COPYING／nested LICENSE。
- `pnpm test -- src/architecture/security-gate-core.test.ts`：37 tests通過。
- `pnpm security:check`：494 files inventoried，通過。

### 尚未完成／下一步

- 最終全域typecheck、lint、format與完整測試由整合Gate統一重跑。

---

## 2026-09-03 — D-089 Clerk主動程式殘留清除

### 已完成

- 刪除已被self-hosted Auth取代的external-provider session ports、actor mapping／verified identity enrollment services及其測試。
- 移除Application層Clerk identity schema／repository contract，以及PostgreSQL Clerk subject mapping repository與測試；保留generic case、policy、deletion與security repositories。
- Security Gate改為在所有目錄拒絕`@clerk/*` SDK import，包括舊adapter路徑；舊Clerk secret／env名稱仍只作fail-closed偵測。
- frozen migration 001／002行為不變，並明確註記`clerk_user_id`只屬歷史schema相容欄位；active self-hosted Auth與synthetic smoke只寫入`null`且不讀取該欄位。

### 驗證

- `pnpm typecheck`與`pnpm lint`通過。
- Security Gate、PostgreSQL repositories／migration、history與self-hosted Auth共5個targeted test files、67 tests通過。
- `pnpm format:check`只回報並行依賴工作修改中的`pnpm-lock.yaml`；本工作涉及檔案沒有格式警告。

### 尚未完成／下一步

- frozen migration與legacy-env拒絕器中的Clerk文字刻意保留作相容性／防回歸證據；不得重新引入active provider runtime。

---

## 2026-09-03 — Self-hosted Auth UI、HTTP路由與滑動Session接線

### 已完成

- 移除App layout、Auth UI、Proxy與Next build設定對Clerk provider／hook／middleware／CSP origin的依賴；全域Host與forwarded-header network boundary仍先於所有Route執行。
- 新增單一RWD Auth panel：登入、註冊、Email驗證、忘記密碼、重設密碼與登出皆呼叫server Route；password／一次性code不進URL、localStorage或sessionStorage，回應文字維持enumeration-safe。
- 新增self-hosted Auth Route Handlers與嚴格body schema、4 KiB streaming limit、exact Host／Origin、double-submit CSRF、SameSite=Strict、HttpOnly account cookie及每分鐘10次process-local Demo rate limit。LAN HTTP固定404；localhost synthetic profile才開放。
- Account Session採7天idle sliding：被動`/api/auth/session`只讀、不延長；owner-scoped history API屬合格活動，成功時同時原子touch PostgreSQL expiry並刷新Cookie `Max-Age`與`Expires`。Logout必須先完成server revoke，不能只清client cookie。
- Synthetic Email outbox以高熵HttpOnly pre-auth browser context的server HMAC digest綁定；不同browser不能取走驗證碼。localhost-only mailbox每次只顯示一次，missing entry回同形隨機decoy避免成為帳戶存在性oracle，LAN／Production不提供此頁。
- Verification／reset的invalid challenge維持generic 202；runtime／database failure分開回503且不暴露內部錯誤。Reset-request為避免Email enumeration，未知帳戶與delivery failure仍回generic 202；該回應不得被當作已寄達證明。
- Register service以`AuthRegistrationError`安全區分`INPUT_NORMALIZATION`、`PASSWORD_HASH`、`ACCOUNT_CREATE`、`CREDENTIAL_LOOKUP`、`CHALLENGE_CREATE`、`DELIVERY`與`RESPONSE_FLOOR`；不保留或暴露原始cause/message。Repository phase只從SQLSTATE導出8個allowlisted safe detail，未知有效SQLSTATE收斂為`POSTGRES_OTHER`，無／惡意getter不猜測detail。Route只在typed error name＋phase＋detail全數allowlisted時輸出`REGISTRATION_<PHASE>_<SAFE_DETAIL>`。Local self-hosted log只寫`AUTH_REGISTER_FAILED_<CODE>`，不讀取或輸出error message、stack、Email、密碼與SQL內容；response floor在所有成功／失敗路徑執行，若floor本身失敗則明確以`RESPONSE_FLOOR`取代先前phase。
- 實機typed phase定位到`ACCOUNT_CREATE`且無SQLSTATE；比對actual Argon2輸出後確認native套件PHC參數順序為`m,p,t`，舊repository validator誤限定`m,t,p`，在SQL前拋出`PASSWORD_HASH_INVALID`。Validator改為順序無關地解析唯一`m／t／p`，拒絕未知／重複／malformed參數，並在repository邊界再次強制`m>=19456／t>=2／p>=1`與完整PHC形狀。
- Auth Route的Host boundary改為共用全域network validator：接受Next.js 16重新注入且與canonical host／protocol／port一致的單值`x-forwarded-*`，仍拒絕mismatch、chain與`Forwarded`。這修正Production Build中`/api/auth/session`被誤回404的bootstrap問題，不會記錄header內容。
- 為localhost實機bootstrap加入typed read diagnosis：只可能是`AUTH_DISABLED`、`NETWORK_<既有reason>`、`HOST_MISSING`或`OK`；local self-hosted拒絕時只記錄穩定reason code，絕不記錄header、Cookie或URL值。Fresh build證明Next.js會正規化Route `Request.url` authority，因此不再拿框架衍生的URL authority與raw Host重複比較；raw Host及forwarded metadata仍由共用network boundary精確驗證。

### 驗證

- `pnpm typecheck`通過。
- Auth UI／Route／CSRF／rate limit／outbox binding／Session sliding／history projection／env／Proxy／Demo readiness等11個targeted test files共62 tests通過（`--maxWorkers=1`）。
- Next.js 16 forwarded metadata回歸修正後，Auth request guard與Route actual-shape共25 tests通過；`pnpm typecheck`再次通過。
- Typed read diagnosis與reason-only logging新增後，request guard／HTTP helper共20 tests通過；targeted ESLint與typecheck通過。
- Register observability及redaction新增後，HTTP／Route／Argon三個targeted test files共26 tests通過；加入phase／floor與SQLSTATE safe-detail回歸後，service＋HTTP兩個targeted test files共57 tests通過；targeted ESLint、Prettier與typecheck通過。
- Actual installed Argon2→PostgreSQL repository createAccount回歸加入後，service／HTTP／repository三個targeted test files共65 tests通過；targeted ESLint與完整typecheck通過。
- Targeted ESLint通過；相關程式已用鎖版Prettier格式化。

### 尚未完成／下一步

- 完整coverage／build／security／browser E2E及實際Synthetic PostgreSQL migration／localhost smoke由最終環境Gate統一驗證。

---

## 2026-09-03 — Self-hosted Auth Demo安全啟動與PostgreSQL 002 Smoke

### 已完成

- User-owned PostgreSQL manager的`Initialize`可冪等升級既有secret檔：保留admin／migration／app隨機密碼，新增獨立32-byte base64url `authToken`；secret檔拒絕四欄以外內容。
- Private App env固定為22個allowlisted keys，加入`RENTPROOF_AUTH_MODE=self_hosted`與`RENTPROOF_AUTH_TOKEN_KEY`，並鎖定loopback `127.0.0.1:3000`、Fixture、synthetic-only及PostgreSQL app role；未知／重複key、非43字元token或錯誤DB endpoint均fail closed。
- 新增`pnpm auth:demo -- StartAuthDemo|StatusAuthDemo|StopAuthDemo`：只由一般使用者啟動既有Production Build；啟動前驗ownership／ACL／DB process／app readiness，secret只進child environment，不進command line或輸出。
- Auth process marker綁PID、Node executable、process start time、repository root及port；停止前重新驗證並只終止該process tree。`Uninstall`在Auth仍運作時拒絕。
- PostgreSQL synthetic smoke涵蓋migration 002四張Auth tables：credential、7天session、verification／reset challenge、跨owner拒絕與cascade cleanup；app readiness固定要求12張產品tables及兩張隔離的Kysely metadata tables。
- 修正PowerShell JSON將ISO timestamp自動轉為本地化字串的差異：直接從raw JSON取出`startedAt`，嚴格解析UTC `O`格式，拒絕invalid／future timestamp，僅容許Windows process time的1秒內精度差；實機`StatusAuthDemo`已回`AUTH_DEMO_RUNNING`且未重啟服務。
- 新增`AuthHttpSmoke`完整loopback驗證：隨機Synthetic帳戶完成CSRF／pre-auth、Email驗證、登入、passive不滑動、history滑動、登出、reset與replay拒絕；`finally`依精確Email／user ID cascade刪除並查核五類資料零殘留。CLI只輸出typed code。

### 驗證

- PowerShell AST：Common及Manager皆無語法錯誤；32-byte base64url generator產生不同且精確43字元token。
- 精確tests：`demo-cluster-script.test.ts` 22 tests與`native-node-cli.test.ts` 9 tests通過；TypeScript及ESLint通過。
- 實機第一次Auth HTTP smoke在舊版generic HTTP assertion停止；`finally`後新增的唯讀`AuthHttpResidueCheck`回`AUTH_HTTP_SYNTHETIC_RESIDUE_ZERO`。後續診斷確認fresh build通過session bootstrap但register回503；現已加入13個phase reason codes、數字status suffix、register本機CSRF／pre-auth Cookie缺失分類，以及register前unknown-login runtime probe。所有診斷均不含response body、identifier或secret；等待managed server完成重建後重跑。
- 本段只完成程式與離線測試；依root review要求，尚未重跑`Initialize`、migration、DB smoke或啟動Auth Demo。未使用Git、真實資料、Firewall或OpenAI。

### 下一步

1. Root review後依已取得的synthetic schema寫入授權，依序執行Initialize／MigrationReadiness／Migrate／Finalize／Readiness／Smoke。
2. 完成Production Build後以一般使用者執行StartAuthDemo並進行loopback browser auth E2E；LAN仍維持Auth disabled。

---

## 2026-09-03 — Apache-2.0與Self-hosted Auth文件收斂

### 已完成

- 依D-090加入並核對根目錄標準Apache License 2.0 `LICENSE`與`NOTICE`，文件明確區分RentProof原創內容、第三方套件、官方來源快照與repository外Demo素材的權利範圍；`package.json`維持`private: true`。
- `docs/DECISIONS.md`將D-011／D-044標為由D-090取代，保留歷史內容；D-047至D-051仍保留並明確標為由D-089取代。
- README、產品、系統架構、Server、UI、技術、Auth／History、安全、三份政策草案、實作計畫、優化清單與Demo測試計畫統一為D-089 self-hosted Email／密碼Auth及7天sliding Account Session，不再把Clerk固定Lifetime或managed identity描述為現行架構。
- Cookie草案改為RentProof第一方opaque Account Session：資料庫只存server-keyed HMAC-SHA-256 digest；只有合格主動使用原子延長7天idle expiry並在成功response刷新Cookie。Guest固定24小時規則不變。
- 因帳戶處理者、credential資料類型與Session期限語意有實質變更，三份尚未生效政策草案分別升為`privacy-draft-0.2`、`terms-draft-0.2`與`cookie-draft-0.2`；產品與架構baseline升為0.4。
- 刪除obsolete `docs/CLERK_LOCAL_DEMO_RUNBOOK.md`；現行外部Gate改為`002_self_hosted_auth` migration、Transactional Email供應商／處理地區、Auth loopback E2E、LAN實機與Production政策／法務Gate。
- `argon2@0.45.1`已依本機安裝發行物核對為MIT，provenance包含package metadata、根與vendored Argon2 License；專案Apache-2.0不改變該上游授權。

### 驗證

- 文件範圍搜尋只保留AGENTS／AUTH_AND_HISTORY的「Clerk已捨棄」現況說明，以及DECISIONS／DEVLOG中的歷史紀錄；現行政策、架構、實作與測試敘述不再依賴Clerk。
- D-090摘要、詳細理由、`LICENSE`、`NOTICE`、`package.json.license=Apache-2.0`與`private=true`一致。
- 只修改文件與授權檔範圍；未使用Git、網路、真實資料或OpenAI。

### 尚未完成／下一步

- `002_self_hosted_auth`仍需在隔離Synthetic PostgreSQL實跑並重新完成readiness／smoke；Auth browser E2E與Transactional Email供應商仍是後續Gate。
- 三份政策維持DRAFT，待營運者、聯絡方式、供應商／地區、未成年人與爭議條款填妥並完成台灣法務／隱私審閱。

---

## 2026-09-03 — 專有部分非自然死亡揭露檢查

### 已完成

- 新增strict domain schema／deterministic evaluator，分開保存出租人持有期間與持有前且其知悉期間，答案只接受`yes／no／unknown`，肯定答案需事件類型。
- 只有可定位的現況確認書、契約或出租人／仲介書面陳述可支持明確揭露；傳聞、地址搜尋、新聞、模型推測、無locator與unknown不形成肯定事實。
- 相同期間可定位的明確yes／no互相衝突才輸出`contradicted`；其餘依證據輸出`supported`或`insufficient_evidence`，並只產生取得雙方簽署現況確認書、書面詢問與保存來源行動。
- 報告新增RWD／print-compatible中立區塊，顯示兩期間、資料狀態、來源筆數、官方範本連結及待辦；不修改sealed Golden素材。
- 報告語言Gate新增是／不是凶宅、機率、分數與黑名單禁語；不輸出合法性、責任、價格影響或人物／地址名單。

### 官方來源

- 使用既有凍結`CONTRACT_TEMPLATE`：內政部不動產資訊平台住宅租賃契約書範本，snapshot SHA-256 `012ed306a85a76d30c09e4f15943509a81ae4a55443e7e8d97a8c9ee1f0b420b`，locator為附件一租賃標的現況確認書之專有部分非自然死亡相關確認項目。

### 驗證

- Domain tests涵蓋兩期間分離、明確支持、同期間衝突、四種排除來源、locator／unknown fail-closed、schema拒絕與禁止輸出欄位。
- UI tests涵蓋兩期間、官方來源、簽署／詢問行動、禁語與axe；既有ReportDocument regression同步更新。
- 未瀏覽地址、未使用真實資料／OpenAI、未變更Golden-v1、未執行Git。

---

## 2026-09-03 — Self-hosted Auth核心與7天Sliding Session

### 已完成

- 依D-089以self-hosted Email／密碼Auth取代Clerk：新增Application contracts／ports／service、PostgreSQL repository與凍結migration `002_self_hosted_auth`。
- `argon2@0.45.1` adapter固定Argon2id `m=19456 KiB／t=2／p=1`；Application在任何hash／verify前限制密碼12–128字元，攻擊者超長／NUL輸入不進native hasher。
- Email identifier採trim＋NFC＋lowercase；新帳戶必須先consume 15分鐘、單次、digest-only Email verification challenge，未驗證不得建立Session。
- Account Session token使用32-byte CSPRNG base64url，PostgreSQL只保存以32-byte server key計算的HMAC-SHA-256 digest。合格主動使用原子延長7天idle expiry並回傳Cookie refresh指示；passive session status不延長。
- Logout撤銷目前Session；Password reset在單一transaction consume challenge、更新Argon2id hash並撤銷全部Session；帳戶停用與Session撤銷也在同一transaction。敏感操作需15分鐘密碼reverification。
- Register／login／reset加入dummy verify與minimum response-floor boundary；loopback synthetic outbox以pre-auth browser context digest＋normalized Email＋用途分區，防止Browser B取走Browser A code。
- migration 002建立`auth_credentials`、`auth_sessions`、`auth_password_reset_challenges`與`auth_email_verification_challenges`；down僅供local／ephemeral，先移除無Clerk subject的self-hosted identities再恢復001約束。

### 驗證

- `vitest`精確執行6個core／adapter／migration測試檔：28 tests passed，包含實際native Argon2 hash／正確與錯誤密碼verify、session fixation／sliding／idle、Email／reset replay、disabled-user reset Gate與跨瀏覽器outbox隔離。
- 本段未執行migration、未啟動Server、未使用真實資料、未執行Git。完整typecheck當下只剩其他並行Auth UI／Proxy切換中的暫態錯誤，core精確測試全綠。

### 尚未完成／下一步

- Root需在已隔離的synthetic PostgreSQL執行002 migration與schema／runtime smoke；route runtime需將eligible activity的`refreshCookie`實際寫回，passive GET不得刷新。
- Transactional Email provider、處理地區、DPA、breached-password provider與Production HTTPS仍屬真實資料Gate；HTTP LAN持續禁用Auth。

---

## 2026-09-03 — 全域Host／Forwarded網路邊界

### 已完成

- 新增Next 16 `src/proxy.ts`全域network boundary，在auth之前驗證所有matched page／API／static request的exact Host；safe GET不要求Origin，既有mutation Origin／CSRF Gate維持。
- Missing／multiple／malformed／非allowlist Host、`Forwarded`、host／proto／port mismatch、forwarded chain與host override headers一律回固定4xx body，不輸出allowlist或env值。
- 依本機Next 16文件與`base-server.js`確認direct server會在Proxy前以socket／Host補齊缺少的`X-Forwarded-*`。Proxy只能驗證其一致性，無法辨識client送入的exact同值；通過後會移除全部forwarded headers，Application／auth／rate limit不得信任該資料。未來若需trusted reverse proxy必須另開profile決策。
- Matcher涵蓋`_next`static／image與favicon；這些資產仍略過auth，但不略過Host Gate。

### 驗證

- Pure boundary與Proxy tests涵蓋allowed／missing／malformed／multiple／wildcard Host、safe GET without Origin、forwarded mismatch／chain、static pre-auth Gate及upstream header sanitation。
- 新增Playwright production E2E，使用actual custom Host header驗證allowlisted 200、evil Host 4xx及forwarded host／proto／port／chain attack 400。
- 未啟動LAN或變更Firewall；LAN實機重建／smoke由root在完整Gate後執行。

---

## 2026-09-03 — User-owned PostgreSQL 18 Synthetic Demo cluster工具

### 已完成

- 新增不註冊Windows Service的cluster manager，固定規劃於`%LOCALAPPDATA%\RentProof\postgres-demo`及loopback port 55432，不修改或停止既有PostgreSQL 17／18 services。
- Lifecycle支援Plan／Initialize／Start／Stop／Status／Provision／MigrationReadiness／Migrate／Finalize／Readiness／Smoke／Uninstall。State-changing actions先驗exact root、fixed NTFS、owner SID marker及reparse條件；Stop另驗authoritative `postmaster.pid`的PID／data root／port／loopback address／ready狀態與PG18 executable。
- Init固定SCRAM-SHA-256、無trust／blank password，以CSPRNG建立分離admin／migration／app credentials。Secret與App env files關閉ACL繼承，只允許目前user及SYSTEM；inheritance／grant兩步驟分別驗exit code並重讀ACL驗證。
- Provision／migration／ACL finalization可重跑；App readiness維持loopback、least privilege、schema、8張產品tables及Kysely metadata隔離。
- 新增獨立、read-only的`MigrationReadiness` action，只驗migration role／loopback／schema權限；實際`Migrate`仍是schema寫入，需另取得使用者明確同意，不因Synthetic Demo而繞過approval。
- 新增synthetic-only `Smoke` action，只以App role在transaction內建立random opaque測試identity／case，驗owner A list／detail／load、owner B隔離、CAS更新及revision conflict；成功明確delete，失敗rollback，最後另查無殘留。輸出不含IDs、state或credential。
- Uninstall只有cluster停止、exact marker／root／owner SID且整棵目錄無reparse point才允許；本次未執行刪除。

### 驗證

- PowerShell parser驗證Common／Manager無syntax error；read-only Plan解析目標為`%LOCALAPPDATA%\RentProof\postgres-demo`、PG18 binaries及55432。
- 經核准後已在上述exact root完成PostgreSQL 18 cluster初始化；實際成功啟動於`127.0.0.1:55432`，沒有註冊／修改Windows Service，也沒有變更既有5432／5433 listener。
- 已以random SCRAM credentials實際Provision `rentproof_demo`、NOLOGIN owner及分離migration／app roles。Read-only `MigrationReadiness`在改用`host(inet_server_addr())`正規化PostgreSQL inet後通過，確認migration role連到loopback且沒有superuser／createdb／createrole／bypassrls權限。
- 實機操作找出並修正：StrictMode scalar `.Count`、`$PID` built-in碰撞、netstat空白列、WMI command-line查詢hang、`Start-Process -Wait`等待整棵descendant tree、project-local `pnpm.CMD`不存在，以及native Node對extensionless TypeScript import失敗。相關functional／subprocess regression已加入。
- 使用者明確核准schema寫入後，`Migrate`實際成功套用`001_initial_real_data_schema`，建立8張產品tables與2張Kysely migration metadata tables；`Finalize`成功撤銷app角色的migration metadata權限，最終app `Readiness`確認loopback、完整schema、safe search path與least privilege全部通過。
- 實際`Smoke`通過：App Readiness回`POSTGRES_READINESS_OK`，合成owner隔離／CAS／cleanup流程回`POSTGRES_SYNTHETIC_SMOKE_OK`。程式內post-transaction residue查詢確認本次random identities／case沒有殘留，輸出未包含ID、state或credential。
- Cluster目前維持running。新增Smoke相關targeted tests為2 files／18 tests；PostgreSQL相關既有7 files／54 tests、完整TypeScript typecheck、ESLint與Prettier check皆通過；未寫入任何真實租屋資料。

---

## 2026-09-03 — LAN Firewall UAC操作入口

### 已完成

- 新增`lan:firewall:install-disabled`／`enable`／`disable`／`verify`四個固定命令；只使用`.env.lan.local`精確IP／port與目前`node.exe`，不接受host／port CLI覆寫。
- UAC broker使用hidden window、bounded wait及timeout cleanup；取消／拒絕／逾時／cleanup failure均回不同typed reason code，不啟動Node或傳遞elevated context給App。
- UAC broker改用UTF-16LE `EncodedCommand`傳遞經PowerShell literal escaping的固定參數，避免含空白Windows path經`Start-Process ArgumentList`重新切詞；不接受換行或NUL。
- 修正NetSecurity generated enum相容性：Enable／Disable固定傳入字串`True`／`False`，不再將PowerShell Boolean交給`Set-NetFirewallRule -Enabled`；操作後仍重新取得snapshot驗證狀態。
- 一般程序將UAC前流程分為CONFIG／RUNTIME_VOLUME／RUNTIME_PREPARE階段；安全的`WINDOWS_*`／`RUNTIME_*`／`PATH_*` dependency code會原樣回報，Node I/O error則轉為不含路徑的stage-specific code，避免只顯示無法診斷的generic failure。
- Codex AppContainer將預設`LOCALAPPDATA` canonical path投影至OpenAI Codex package `LocalCache`時，維持`RUNTIME_REPARSE_POINT_DISALLOWED`安全規則，不將投影加入allowlist；Operator另回`LAN_FIREWALL_EXTERNAL_TERMINAL_REQUIRED`，要求在一般PowerShell重跑精確pnpm命令。
- Elevated helper只委派既有exact-scope manager，並以`CreateNew`在validated fixed-NTFS runtime child寫入最小typed result；一般程序驗證action／enabled狀態後刪除result與空child。
- Firewall管理不讀取或自動設定no-port-forwarding／UPnP／tunnel逐次assertion；install永遠驗證為disabled，enable／disable後均重新驗證scope與狀態。

### 驗證

- TypeScript operator tests與PowerShell contract tests涵蓋exact synthetic LAN config、wildcard／real-data／Clerk拒絕、typed result、dependency／I/O安全錯誤映射、嚴格Codex LocalCache形狀辨識、UAC cancel／timeout markers、exclusive result及四個固定package commands。
- PowerShell functional mock分別執行Enable／Disable manager，確認`-Enabled`收到`System.String`的`True`／`False`，並確認post-operation snapshot為預期狀態；未呼叫真實NetSecurity cmdlet。
- 三份PowerShell檔案通過PowerShell AST syntax parse；已多次執行read-only Verify及UAC安裝嘗試，但目前規則仍不存在、未啟用，也沒有開放任何port。

---

## 2026-09-03 — Demo operational readiness 與本機Fixture啟動

### 已完成

- 新增`pnpm demo:check`，以不輸出secret的typed PASS／WARN／BLOCKED結果檢查toolchain、Golden seal、runtime、listener、LAN Firewall、Clerk、PostgreSQL與OpenAI Project設定。
- 新增Clerk localhost離線`pnpm auth:smoke`、Dashboard確認Gate與操作手冊；沒有明確opt-in時不載入SDK、不讀env檔、不連Clerk。
- 新增PostgreSQL loopback listener、migration／app權限readiness、無密碼bootstrap／ACL finalize SQL與操作手冊；既有5433通過loopback-only，wildcard 5432明確拒絕。
- 以強制Fixture、空OpenAI key啟動Production Build於`http://127.0.0.1:3000`；Runtime回fixture／synthetic-only／synthetic auth，首頁200，Auth與History在Synthetic build維持404。

### 驗證

- 完整Coverage：103 files／877 tests通過；statements 85.58%、branches 80.98%、functions 88.58%、lines 87.60%。
- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`與424檔Security Gate通過；Production assets沒有source map，瀏覽器E2E 11 passed／3 intentional mobile skips。
- Local readiness為8 PASS／2 WARN／0 BLOCKED；LAN readiness精確回報3項逐次Router／UPnP／Tunnel確認未完成及`LAN_FIREWALL_RULE_MISSING`。
- 嘗試透過UAC安裝預設停用Firewall規則，但UAC未獲互動確認，驗證後規則仍不存在；沒有開放任何port。
- 未連Clerk、未呼叫OpenAI、未執行Git；PostgreSQL只建立完全synthetic、loopback-only的獨立Demo cluster／DB／roles／schema。

### 尚未完成／外部Gate

- LAN需操作人員以Administrator完成精確Firewall規則安裝，並逐次確認無Port Forwarding、UPnP對外暴露或Tunnel後才可啟用。
- PostgreSQL synthetic Demo migration與app readiness已完成；既有PostgreSQL Windows Services及5432／5433均未修改。
- Clerk需操作人員完成Development Dashboard／Email／origin／data-region檢查並提供本機keys；政策仍是DRAFT。

---

## 2026-09-03 — Clerk Local Demo離線readiness與操作手冊

### 已完成

- 新增五項Clerk Development Dashboard assertion Gate：Hobby能力、Email password、Email delivery、SMS disabled與exact origin均需由操作人員明確確認；任一缺少時Clerk build／啟動fail closed。
- Clerk frontend origin除了拒絕HTTP、wildcard、path、query與fragment，現在還必須與publishable key內編碼的Frontend API host一致；任意mismatch不會加入CSP。
- Server environment、Next build profile與validated launcher同步相同的loopback／key shape／origin／Dashboard契約；Synthetic／LAN出現credential、origin或任何啟用assertion皆拒絕。
- 新增`pnpm auth:smoke`離線readiness命令：需`RENTPROOF_CLERK_SMOKE=offline-readiness`雙重opt-in，不載入env檔、不import Clerk SDK、不發provider request，也不輸出key。未設定時清楚skip，partial設定非零失敗。
- 新增`docs/CLERK_LOCAL_DEMO_RUNBOOK.md`，記錄Hobby feature限制、Email-only註冊／reset、精確loopback origin／redirect、空白env contract、build／start一致性與人工smoke步驟。

### 驗證

- Readiness targeted Vitest：3 files／20 tests通過；涵蓋explicit opt-in、unconfigured skip、partial failure、完整虛構設定、key／origin mismatch、LAN拒絕與不輸出credential。
- `pnpm auth:smoke`在未opt-in狀態回`CLERK_LOCAL_SMOKE_SKIPPED_EXPLICIT_OPT_IN_REQUIRED`，未讀取`.env.local`或呼叫Clerk。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`與Default Synthetic `pnpm build`通過；Turbopack同時替換client、proxy與server runtime adapters，`.next/static`及`.next/server/chunks`的`@clerk`、`ClerkProvider`、`clerkMiddleware`、`clerkClient`、`clerk-js`與`__clerk` SDK markers為0。
- 未建立、讀取或輸出真實Clerk key，未連Clerk／PostgreSQL／OpenAI，未執行Git。

### 尚未完成／風險

- Repository無法自行驗證Dashboard plan、Email實際送達、data region或DPA；人工assertion只是一道啟動Gate，不是外部事實證明。Live auth smoke仍需使用者另行明確授權並提供完全虛構帳戶。
- `pnpm security:check`在並行Demo readiness guard完成scanner相容修正後通過，共盤點422檔；本Clerk slice沒有放寬secret scanner。

---

## 2026-09-03 — Demo唯讀就緒檢查

### 已完成

- 新增`pnpm demo:check`與`--profile=lan`，輸出typed `PASS`／`WARN`／`BLOCKED`清單；只有requested profile的blocker回傳非零。
- 檢查鎖版Node／pnpm、外部Golden version／manifest seal／完整inventory、fixed NTFS與runtime path boundary、synthetic HTTP profile、listener port、Clerk presence、PostgreSQL loopback listener及OpenAI Project-limit operator assertion。
- 檢查器不連OpenAI／Clerk、不使用PostgreSQL credential登入、不顯示任何secret或connection string、不修改env／Firewall／runtime／Demo資料。
- LAN把三個逐次exposure confirmation、missing／disabled／permission-required／invalid Firewall狀態拆成不同reason code，不把受限權限誤稱為unsafe rule。

### 驗證

- Targeted Vitest：1 file／7 tests通過，涵蓋local success、LAN blockers與secret redaction、Live warning、PostgreSQL loopback probe及dependency failure mapping。
- 實際`pnpm demo:check`：Golden-v1共18檔與固定SHA-256通過，local profile為8 PASS／2 WARN／0 BLOCKED；未初始化runtime與Live Project limits未確認維持warning。
- 實際LAN檢查辨識目前三項run confirmation缺失與managed Firewall rule缺失；未嘗試安裝、啟用或修改Firewall。

---

## 2026-09-03 — PostgreSQL Synthetic Demo維運工具

### 已完成

- 新增無密碼、可重跑的PostgreSQL Demo bootstrap SQL：建立NOLOGIN owner、分離migration／app roles、`rentproof`schema、安全`search_path`、statement／idle transaction timeout與default privileges。
- 新增migration後finalize SQL，App可讀寫8張產品tables，但不能存取Kysely migration metadata或建立schema object。
- 新增Windows TCP listener fail-closed檢查與unit tests；wildcard、LAN address、找不到listener及無法解析的netstat輸出皆拒絕。
- 新增migration／app readiness，驗證實際server address、database／role、危險role flags、schema privileges、search path、產品tables及migration metadata ACL；只輸出不含credential的狀態。
- 新增`docs/POSTGRES_DEMO_RUNBOOK.md`，以互動式`psql`與session限定SecureString注入操作，未把密碼寫入SQL、repository或command line。

### 本機唯讀盤點

- PostgreSQL 17目前在`0.0.0.0:5432`與`[::]:5432`監聽，不符合RentProof要求；未修改或停止服務。
- PostgreSQL 18目前在`127.0.0.1:5433`與`[::1]:5433`監聽，`pnpm db:listener:check -- 5433`可驗證此條件。
- `pg_isready`確認5432／5433均接受TCP；無密碼／SSPI唯讀登入被拒絕。因缺少操作者提供的管理員及dedicated role credentials，本次未建DB、未執行migration，也未輸出或保存credential。

---

## 2026-09-03 — Synthetic build Clerk client SDK隔離

### 已完成

- 依Next.js 16本機文件使用Turbopack `resolveAlias`：預設Synthetic build將Clerk client boundary替換成typed SDK-free stub，Build不再解析`@clerk/nextjs` client套件。
- 新增build-profile Gate；只有loopback `local_development`、明確Clerk mode、完整Development credentials與精確HTTPS Clerk frontend origin同時成立時才選用真實client boundary。
- Clerk frontend origin拒絕HTTP、wildcard、path、query、fragment與credential-bearing URL；只在Clerk build加入CSP的`script-src`、`connect-src`、`img-src`與`frame-src`，Synthetic build維持不含第三方origin。
- Server environment與validated launcher同步驗證相同origin契約；Synthetic／LAN設定出現任何Clerk configuration皆fail closed。

### 驗證

- Default Synthetic production build通過；built-assets Security Gate通過406檔盤點，`.next/static`沒有`CLERK_SECRET_KEY`、`NEXT_PUBLIC_CLERK_*` secret names、`@clerk`或`ClerkProvider`標記。
- 以完全虛構credential與origin完成一次local Clerk build，確認真實client build path可編譯；未連Clerk。之後重新建立Default Synthetic build，避免留下Clerk client assets。
- Default production server smoke：`/auth`、`/history`、`/api/history`及`/api/auth/reset/start`在Synthetic mode均回404。
- 完整`pnpm test:coverage`：98 files／845 tests通過；全域statements 88.38%、branches 84.10%、functions 91.12%、lines 90.22%。`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`與`pnpm security:check`通過。
- 最終Fixture Production Build瀏覽器回歸：Desktop／Mobile共11項通過，3項Mobile singleton mutation依設計skip；Build production assets為0個source map。受限沙箱首次啟動Chromium回`spawn EPERM`，取得授權後以相同Build重跑通過。
- `pnpm audit --prod`回報沒有已知Production相依漏洞；`pnpm install --frozen-lockfile`與Node／pnpm toolchain檢查通過。
- 未連Clerk、PostgreSQL或OpenAI，未執行Git。

---

## 2026-09-03 — Auth／History UI coverage Gate 補強

### 已完成

- 擴充AuthPanel行為測試，涵蓋登入、註冊與Email驗證、完整密碼重設、重設狀態清除、session撤銷、重新登入要求、Clerk未載入、incomplete provider結果與enrollment失敗。
- 驗證所有認證錯誤維持generic anti-enumeration訊息，不顯示provider細節；測試使用可控Clerk hooks、fetch與router mocks，不連外部服務。
- 補齊History list的四種typed狀態、opaque case ID URL encoding、empty state與返回導覽；新增History detail對Fixture／OpenAI Live來源分支、owner-scoped摘要與axe檢查。
- 未降低coverage門檻、未新增exclude、snapshot或ignore註解，也未修改production認證／資料庫程式。

### 驗證

- 元件targeted Vitest：3 files／12 tests通過。
- 完整`pnpm test:coverage`：97 files／836 tests通過；全域statements 88.37%、branches 83.94%、functions 91.09%、lines 90.21%。
- `src/components/**`：statements 88.96%、branches 85.71%、functions 91.25%、lines 92.83%，通過80／75分級門檻。
- `pnpm format:check`、`pnpm lint`與`pnpm typecheck`通過；未連Clerk、PostgreSQL或OpenAI，未執行Git。

---

## 2026-09-03 — P0狀態與Clerk／PostgreSQL授權文件校正

### 已完成

- 將README、實作計畫與優化清單由scaffold前／待實作敘述更新為目前P0實作狀態，並明確區分程式完成、外部環境Gate與first real-data release。
- 將官方規則文件的過期敘述修正為6條P0 allowlisted evaluators、reason-code templates與regression已實作；規則內容仍維持DRAFT，UI不得宣稱法律審查。
- 依本機已安裝發行物的`package.json`與隨附`LICENSE`核對`@clerk/nextjs@7.8.4`、`kysely@0.29.5`、`pg@8.23.0`及`@types/pg@8.23.1`均標示MIT，補入第三方授權盤點與provenance。
- 文件只把Clerk／PostgreSQL描述為Demo-safe、feature-gated切片；沒有宣稱實際Clerk instance、keys、Email delivery、live PostgreSQL migration、LAN實體smoke或真實資料Production已完成。

### 驗證

- 以本機`node_modules`逐一讀取上述四個套件的version、license metadata與隨附License；未使用網路。
- 對5份修改文件執行鎖版Prettier；格式化完成。
- 未修改程式、lockfile或環境secret，未連Clerk／PostgreSQL／OpenAI，也未執行Git。

### 尚未完成／風險

- Clerk Dashboard、Email設定、keys、local PostgreSQL instance／角色／migration實跑、Windows LAN另一台裝置smoke與OpenAI Project limits仍是外部Gate。
- 三份政策維持DRAFT；正式營運者、聯絡方式、處理地區、未成年人與爭議條款及台灣法務／隱私審閱尚未完成。

---

## 2026-09-03 — Clerk＋PostgreSQL 帳戶歷史垂直切片（Demo-safe）

### 已完成

- 新增Application `CaseHistoryService`與read-model port；只有server-side解析出的`user ActorContext`可列出或讀取案件，guest、signed-out、reset task與未驗證Email均拒絕。
- 新增PostgreSQL history adapter，以`owner_type=user`＋internal `userId`＋`deleted_at IS NULL`及非刪除狀態作每次查詢條件；list最多50筆，detail不回傳JSON state、Clerk subject、session或DB連線資訊。
- 新增`/api/history`、`/api/history/[caseId]`、`/history`與案件摘要頁；UI採mobile-first、清楚字級與寬鬆卡片，空歷史明確說明登入不會自動保存guest案件。
- 新增local-only `/api/auth/enroll`：登入／註冊成功後由server重新查Clerk primary Email驗證狀態，再以literal verified fact建立internal user mapping；client不傳Email驗證狀態、不接觸DB credential。
- History composition只在`local_development`＋Clerk＋明確PostgreSQL app adapter下啟用。requested PostgreSQL缺少或無效時回typed unavailable，不fallback到記憶體資料；LAN／synthetic auth固定404且不執行enrollment或DB history。
- IDOR採indistinguishable not-found：User B持有User A opaque case ID仍只得到相同404，opaque ID不取代owner authorization。

### 驗證

- `pnpm typecheck`與`pnpm lint`通過。
- Auth／history／PostgreSQL／route／component及HTTP profile targeted Vitest共15 files／66 tests通過；另history focused suite 6 files／13 tests通過。
- 測試涵蓋User A／B隔離、unauthenticated與guest拒絕、LAN auth route disabled、DB未設定fail closed、API／UI不輸出Clerk session、credential或connection string，以及history component axe檢查。
- 未連Clerk、未連PostgreSQL、未執行migration、未使用OpenAI、未讀取或輸出credential、未執行Git。

### 尚未完成／風險

- 真正Demo操作仍需操作人員建立Clerk Development instance、確認Hobby／Email delivery／data region，並提供local-only keys；PostgreSQL需另行安裝、建立loopback-only synthetic demo database及以獨立migration role執行migration。
- 此切片只保存與顯示Synthetic Demo案件摘要；guest-to-user原子案件轉移、完整刪除／purge worker、backup／PITR與真實資料Production Gate仍未宣稱完成。Production HTTPS invariant與LAN synthetic-only邊界未變更。

---

## 2026-09-03 — Clerk 本機Demo Auth邊界與安全重設流程

### 已完成

- 新增vendor-neutral `AuthProviderPort`／`ActorSessionPort`／identity mapping與verified enrollment ports；Application只接收內部`ActorContext`，不import Clerk SDK、不以Email作owner key。
- 新增Clerk infrastructure adapter，server-side解析user／session reference，並在每次Actor解析及首次enrollment時重新核對primary Email verification；未驗證、已撤銷驗證、reset task、partial provider response或mapping不存在皆fail closed。
- 新增local-only Clerk configuration Gate：`RENTPROOF_AUTH_MODE=clerk`只允許`127.0.0.1`的`local_development`且同時具備server-read publishable／secret keys；`lan_development`仍固定synthetic，存在任何Clerk credential或啟用auth即拒絕啟動。
- 新增Next 16 `proxy.ts`的Clerk adapter、條件式`ClerkLocalProvider`與單一登入／註冊／忘記密碼面板。註冊只使用Email verification；沒有SMS／phone欄位，也不保存密碼、OTP、Clerk token或session cookie。
- 新增custom Email password reset：開始時寫入HttpOnly／SameSite Strict短效reset-task marker，使Actor解析在整段流程都拒絕；設定新密碼時要求Clerk撤銷其他sessions，再由Backend撤銷reset-created current session、清marker並要求一般登入。Revoke失敗維持deny-by-default。
- Clerk SDK import只存在`src/adapters/auth/clerk/`；publishable key由Server明確傳入Provider，不使用`NEXT_PUBLIC_*` secret-like環境變數，也未放寬既有client secret scan。

### 驗證

- `pnpm typecheck`、`pnpm lint`與`pnpm security:check`通過；Security Gate盤點391檔。
- Auth targeted Vitest共10 files／30 tests通過；另Conversation shell相關整合共9 files／36 tests通過。
- 測試涵蓋signed-out／reset-task／unverified Email／missing mapping拒絕、malformed Clerk response、local exact Origin＋CSRF、LAN auth拒絕、credential/profile fail-closed、generic anti-enumeration訊息與auth panel axe component check。
- 未連Clerk網路、未使用真實帳戶、未讀取或輸出任何credential、未執行Git。

### 尚未完成／風險

- 真正Clerk Development instance的key、Hobby plan／Email delivery／data region仍需操作人員在Dashboard確認，之後才可跑live auth smoke；目前自動測試只使用mock adapter。
- Production HTTPS／Secure cookie invariant未變更；LAN HTTP仍不載入Clerk、login/reset route能力或credential。PostgreSQL identity mapping／history composition由並行工作整合，需全域owner-isolation Gate後才能宣稱完整。

---

## 2026-09-03 — PostgreSQL／Kysely基礎adapter（Demo-safe）

### 已完成

- 新增Application層的identity mapping、policy event／cookie preference、case deletion及最小security audit repository ports；Domain／Application未import Kysely或node-postgres。
- 新增Kysely＋node-postgres infrastructure adapter：Internal User／Clerk subject查詢與verified enrollment mapping、owner-scoped JSONB case state CAS、case-bound policy owner check、purpose-separated cookie preference、原子case deletion request及append-only最小security audit event。
- 新增凍結的`001_initial_real_data_schema` TypeScript migration與Kysely Migrator provider；migration不import目前Domain／Application code，也不由Next web startup／request執行。
- 新增獨立`pnpm db:migrate -- up|down` operator command；要求migration role，`down`只允許`local_test`。
- 新增local-only database configuration Gate：PostgreSQL只能連loopback／local endpoint；HTTP local／LAN只接受database name含`demo`、`RENTPROOF_ALLOW_REAL_DATA=false`的synthetic環境。Production config仍要求Production profile、real-data opt-in與HTTPS。
- `.env.example`只增加blank／disabled database欄位，未建立或輸出任何DB credential；LAN Browser無法取得connection string，DB port也不得對LAN開放。

### 驗證

- PostgreSQL targeted Vitest共3 files／33 tests通過，使用fake `pg` pool執行實際Kysely SQL compilation／transaction，不需要live database。
- 測試涵蓋loopback／remote endpoint、exact synthetic database name／credential URL、Production TLS Gate、server-verified Clerk mapping（未驗證Email fail closed）、owner-scoped case load／CAS、非owner indistinguishable result、published-policy owner check、cookie purpose、deletion transaction、minimal audit與完整migration up／down DDL。
- `pnpm typecheck`針對本工作新增檔案沒有錯誤；未執行migration、未連資料庫、未讀取API key、未執行Git。全域Gate由主流程在並行Auth／History整合後統一執行。

### 尚未完成／風險

- Adapter尚未組裝進HTTP web routes；Synthetic Demo要切換PG仍需主流程完成composition與live PostgreSQL安裝／ACL／listener驗證。這個scaffold不宣稱Production backup、PITR、purge worker、HA或真實資料Gate已完成。

---

## 2026-09-03 — RP-DEV-007 Windows JSON Runtime持久化與清理

### 已完成

- 新增真正的Windows JSON filesystem adapter，只接受經D-067驗證、位於runtime root正下方且ownership marker／run manifest一致的app-owned run；storage key只允許`cases/{opaqueId}.json`，不提供任意path API。
- State保存使用per-case in-process lock、expected-text CAS、同目錄隨機temp file、file `fsync`與atomic rename；成功寫入後才更新`lastWrittenAt`，讀取或CAS失敗不延長Development保存期限。
- 新增strict runtime root marker、child ownership marker與run manifest；Development與Formal Demo各自使用不可猜測run child，manifest記錄created／last-written／status／process／instance資料，schema或owner不一致皆fail closed。
- 新增Windows native path probe composition：以既有ancestor realpath、fixed-volume查核及reparse-point查核驗證runtime；非Windows、UNC／removable／network、repository／Demo／public／Documents／OneDrive overlap維持拒絕。
- 新增Development最後寫入7天清理、Formal Demo正常停止立即清理及下次preflight清除abandoned formal run；cleanup使用root exclusive lock，拒絕active run，刪除前重驗direct-child、realpath、fixed volume、marker與整棵tree的reparse狀態。
- Cleanup採先完整掃描、後bottom-up刪除；若任一descendant是symlink／junction／reparse或非一般file／directory，不先刪任何bytes，也不刪runtime root、repository或Demo。
- 新增`src/server/runtime` composition root，把validated lifecycle、磁碟filesystem與既有typed `JsonCaseStateRepository`組合；未修改auth、Live evidence、UI或Demo資料夾。

### 驗證

- Targeted TypeScript／ESLint通過；targeted Vitest共7 files／52 tests通過。
- `pnpm test:coverage`全套80 files／758 tests通過；Statements 88.54%、Branches 83.60%、Functions 91.50%、Lines 90.31%，所有global／module門檻通過。
- 真實filesystem測試全部使用`mkdtemp`建立自己擁有的temp root，清理前再驗證RentProof test prefix；涵蓋atomic CAS競爭、無temp殘留、storage traversal拒絕、7天邊界、Formal Demo stop／abandoned清理、active保留、cleanup lock與reparse descendant零部分刪除。
- Runtime範圍的Prettier check通過。全域`security:check`在同時進行的Auth工作新增`.env.example` Clerk publishable key後由既有`NEXT_PUBLIC_SECRET_NAME_FORBIDDEN`規則阻擋；該跨工作整合衝突已回報主流程，本工作未修改或放寬Security Gate。
- 未執行Git、未讀取或輸出API key、未發OpenAI request，且App沒有建立／寫入外部Demo資料夾。

### 尚未完成／風險

- P0仍為Windows單process JSON runtime，不宣稱multi-process lock、Production durability或Production deletion SLA；Production PostgreSQL／backup／owner-scoped deletion仍屬真實資料階段。

---

## 2026-09-03 — P0牆面補拍閉環

### 已完成

- 新增typed牆面補拍use case，只接受Server解析的sealed `follow_up` sanitized receipt與image locator；Browser只能提交receipt ID與expected revision，不能自行回報Observation、Finding、狀態或locator。
- 補件只更新固定的`observation_wall_discoloration_01`與`finding_wall_follow_up_00001`相依節點；其他claim finding的ID、三態與source refs原樣保留。
- 牆面文字固定為「牆面可見不明變色；僅記錄可觀察現象」，後續只要求補拍指定範圍與索取可定位修繕紀錄，不推斷漏水、結構安全或責任歸屬。
- 新增owner-bound P0 dev actor、revision CAS、per-case concurrency與payload-bound idempotency；同key同payload重用，同key不同payload、stale revision與重複套用皆fail closed。
- 新增`POST /api/cases/:caseId/findings/:findingId/follow-ups`，保留exact Host／Origin、CSRF、no-store與synthetic-only Gate；Fixture／Live分析完成後都只把Server驗證的snapshot註冊為補件基線，不額外呼叫OpenAI。
- Golden UI在載入補拍後顯示局部更新結果、補拍前／後來源連結與修繕紀錄行動；client僅渲染strict response schema，不自行判斷domain狀態。
- 新增use-case unit、Route與RTL測試，以及完全mock API／不呼叫OpenAI的Playwright補拍流程。

### 驗證

- `pnpm typecheck`、`pnpm lint`、`pnpm security:check`與`pnpm build`通過；Security Gate盤點339檔。
- Targeted Vitest：3 files／21 tests通過。
- Playwright testcase已建立；受限沙箱首次啟動Chromium回`spawn EPERM`，授權重跑已啟動但工具未回傳完成摘要，留待root完整E2E Gate統一確認。
- 未執行Git、未讀取或輸出API key、未發OpenAI request；未修改Production HTTPS、auth、database或runtime persistence邊界。

---

## 2026-09-03 — RP-DEV-012 P0整合安全矩陣

### 已完成

- 新增跨Conversation、Confirmation、Idempotency、Upload及OpenAI Adapter邊界的P0安全整合矩陣；測試只使用fixture／fake provider，不讀`.env.local`、不呼叫真實API。
- 覆蓋direct／indirect prompt injection、role spoof、JSON smuggling、Bidi與zero-width Unicode、HTML／script輸入，以及prompt、API-key-shaped內容與private path不回顯。
- 驗證Fixture Route沒有static OpenAI／Live import、執行時不發network；同一idempotency key＋payload重用既有結果，跨actor／case／payload replay fail closed。
- 驗證偽造或跨case confirmation不改案件revision，惡意檔名、fake MIME與stream oversize在upload boundary被typed error拒絕。
- 驗證OpenAI incomplete、refusal、schema invalid、locator invalid、auth及rate-limit保留不同typed failure，不回成功結果。
- 驗證P0 HTTP profiles無法把`RENTPROOF_ALLOW_REAL_DATA`切為true、無法把Production塞入HTTP Development launcher，且P0 App tree不存在account auth route；Production HTTPS要求未被Development例外弱化。

### 驗證

- Targeted Vitest：2 files／21 tests通過。
- `pnpm test:coverage`：76 files／742 tests通過；Statements 90.39%、Branches 85.54%、Functions 94.23%、Lines 92.06%，所有門檻通過。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`與`pnpm security:check`通過；Security Gate盤點338檔。
- 未執行Git、未讀取API key、未發OpenAI request。

---

## 2026-09-03 — OpenAI Live啟用與雙模型實測

### 已完成

- 依使用者指示將`.env.local`切換為`RENTPROOF_LLM_MODE=live`；API key只由Server讀取，未在工具輸出、log、UI或文件中顯示。
- 實際確認scoped key可存取`gpt-5.6-luna`與`gpt-5.6-terra`；Luna conversation route以sealed synthetic state完成HTTP 200 strict AssistantTurn smoke。
- Live `analysis-runs`完成四階段`listing.extract → evidence.extract → contract.extract → interaction.extract`，只接受sealed synthetic receipts／interaction；Fixture與Live明確分流，任一provider／budget／schema／locator失敗皆不commit且不fallback。
- Live Snapshot記錄requested／resolved model與service tier、usage／attempt、Evidence budget及stage provenance；三態、6條規則、FRS-001與report actions仍由Server確定性邏輯產生。
- 新增三重opt-in的`pnpm eval:live -- --live`；修正Structured Output schema name不得含模型ID的小數點後，實際Luna／Terra smoke皆完成。

### 實際Live Smoke

- Luna：`completed`、requested／resolved tier=`default`、input 74、output 47、reasoning 20、total 121 tokens。
- Terra：`completed`、requested／resolved tier=`default`、input 74、output 38、reasoning 11、total 112 tokens。
- 所有request皆固定`store: false`、`tools: []`與strict schema；輸出未包含prompt、response text、key或request ID。

### 實際Golden Terra四階段

- 完整sealed Golden案件回201，`listing／evidence／contract／interaction.extract`各1次attempt，resolved model皆`gpt-5.6-terra`、resolved tier皆`default`。
- 累計usage：4 attempts、input 8,748、output＋reasoning 11,031 tokens；usageKnown=true，engineeringAlertReached=false。
- 確定性結果包含月租／管理費支持、電費明確矛盾、洗衣機證據不足、租金補貼明確矛盾、RP-010疑似差異與FRS-001看屋前付款`detected／stop_and_verify`。
- Live eval找出並修正：public version不得作opaque model case ID、短artifact ID需server alias、bbox／PDF／text locator約束、12K request與8K reservation不一致、canonical semantic keys、TWD amountMinor整數元語意，以及不同NormalizedValue type不得當作相反證據。所有修正均維持fail closed並補測試。

### 最終驗證

- Node 24.20.0／pnpm 11.25.0：`pnpm env:check`通過；`pnpm install --frozen-lockfile`未改寫lockfile。
- `pnpm test:coverage`：72 files／713 tests通過；Statements 91.23%、Branches 86.27%、Functions 94.04%、Lines 92.66%，所有global／module門檻通過。
- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`與`pnpm security:check`通過；Security Gate盤點325檔，server／browser source maps皆0。
- Playwright由自己的Fixture Production Server執行，10 passed／2個預期mobile singleton tests skipped；E2E不呼叫OpenAI。首頁改為dynamic runtime projection，避免Build-time Live／Fixture標示漂移。
- Live smoke與完整Terra案件是獨立明確opt-in；後續離線Gate未再發付費request。

### 尚未完成

- `OPENAI_PROJECT_LIMITS_CONFIRMED=false`；US$50／US$80 alerts、US$100 hard limit與Luna／Terra Dashboard rate limits尚未由操作人員核對。Live可產生費用，UI與runtime status會持續顯示警告。
- LAN、Production auth與真實資料仍未啟用；Live僅處理sealed synthetic Golden素材。

---

## 2026-09-03 — Toolchain一致性Gate

### 已完成

- 新增離線`pnpm env:check`，strict比對`.node-version`、`packageManager`、Node／pnpm engines、實際Node process與pnpm lifecycle版本；版本缺失、浮動或漂移一律fail closed。
- Gate不發網路、不安裝套件、不輸出環境變數或secret，且只接受exact semantic versions。
- README安裝驗證流程加入toolchain Gate。

### 驗證

- `pnpm env:check`確認Node.js 24.20.0與pnpm 11.25.0完全一致。
- 新增toolchain contract單元測試，涵蓋有效版本、無效JSON、缺漏／浮動contract、engines漂移與實際版本不符。
- 未執行網路、安裝或Git操作。

---

## 2026-09-03 — Live雙模型Smoke Gate與安全狀態投影

### 已完成

- 新增`pnpm eval:live -- --live`雙模型smoke／eval工具，以固定synthetic prompt檢查Luna與Terra的Responses access、strict Structured Output、`tools: []`、`store: false`、requested／resolved `service_tier: default`及已知usage。
- Live smoke同時要求CLI `--live`、`RENTPROOF_LLM_MODE=live`與`RENTPROOF_LIVE_SMOKE=1`；CI一律skip。未明確opt-in時不讀`.env.local`、不載入OpenAI adapter且不發request。
- Smoke輸出只含model、status、requested／resolved tier、usage數字與typed reason code；不輸出API key、request／response文字、provider error message或request ID。Auth、rate limit、model unavailable、incomplete、refusal、schema invalid、usage unknown與tier／model mismatch皆分開分類。
- 移除Live Conversation Runtime內硬編的Fixture snapshot ID、revision與全部`knownFields: true`。現在先驗證sealed synthetic snapshot，再搭配confirmation case aggregate投影最小ServerConversationState；只把欄位是否已知送給模型，不傳實際值。
- 依OpenAI官方Responses API文件核對：明確設定`service_tier`時response會回實際tier，response具status／usage；Structured Outputs可用strict JSON schema。子任務交付時未呼叫API，後續實測記錄見上方最新小節。

### 驗證

- Targeted Vitest：3 files／19 tests通過，涵蓋雙模型request、safe output、錯誤分類、CLI opt-in／CI fail-closed與sealed state projection。
- 全套`pnpm test`：71 files／706 tests通過；同步修正Live模式警示文字更新後的一項舊UI assertion。
- `pnpm test:coverage`：71 files／706 tests通過；Statements 91.91%、Branches 87.96%、Functions 93.97%、Lines 93.26%，所有門檻通過。
- `pnpm format:check`、全域`pnpm lint`、`pnpm typecheck`與`pnpm security:check`通過；Security Gate盤點324個檔案。
- CLI dry-run：無flag回`LIVE_SMOKE_OPT_IN_REQUIRED`；CI即使提供所有Live flags仍回`LIVE_SMOKE_DISABLED_IN_CI`，兩者均未發provider request。
- Node.js 24.20.0可直接載入CLI使用的type-stripped TypeScript adapter。
- 初次整合Typecheck曾發現同時開發中的`analysis-runs` Route暫態型別錯誤；該工作完成後重跑全域Typecheck已通過，本段未修改該Route。
- 子任務實作與mock驗證未執行Git或Live API；後續由主流程在使用者明確切換Live後執行最小smoke。

### 尚未完成

- Luna／Terra account access與strict smoke已驗證；OpenAI Project額度／速率設定仍未確認，因此保持明確configuration warning。

---

## 2026-09-03 — Live Runtime 狀態與Project額度警示

### 已完成

- 新增server-owned `rentproof.runtime-status.v1`安全投影，只公開Fixture／Live、部署profile、HTTP、synthetic-only與Project limits confirmed／unverified；不公開API key、credential、模型名稱或其他secret。
- 首頁改由Server Component注入runtime狀態，不再在Client硬編Fixture；另提供`GET /api/runtime-status`的`private, no-store`安全狀態查詢。
- `.env.example`、Server env與validated launcher新增strict `OPENAI_PROJECT_LIMITS_CONFIRMED=true|false`。Live且為false仍可啟動，但console與UI會明確警告，不宣稱已受Project額度保護。
- UI持續顯示HTTP／synthetic-only邊界；Live且Project limits未確認時以semantic alert提醒核對每月上限、警示與模型速率限制。

### 驗證

- 新增runtime projection、status route與ConversationShell component tests；全套`pnpm test`為68 files／681 tests通過。
- `pnpm typecheck`、`pnpm lint`與`pnpm security:check`通過；Security Gate共盤點315個檔案。
- 全程未執行Git，也未在狀態投影或測試輸出API key。

### 尚未完成

- `OPENAI_PROJECT_LIMITS_CONFIRMED=false`代表Dashboard limits仍未經操作人員核對；Live可能產生費用，UI會持續警示。

---

## 2026-09-02 — P0 Golden Fixture 垂直閉環完成

### 本次目標

- 在不使用Git、不接受真實資料且不啟用Production能力的前提下，完成可操作的單人P0 Golden Demo、OpenAI adapters、安全邊界與交付驗證。

### 已完成

- 建立外部`%USERPROFILE%\RentProof-Demo\cases\golden-v1`：12張看屋JPEG、廣告PNG、兩頁文字型租約PDF、牆面補拍PNG、synthetic interaction、人工truth與Fixture fallback，共18檔；`manifest.json`＋sidecar SHA-256 `f3797356a1e3ea4bbed7a87802fdaaa001985557fb7b51845a9f6a4454157d7b`已封存且不在repository。
- Conversation-first RWD網站具四區Radix Tabs workspace、受控Golden素材載入、自由文字對話、PII acknowledgement、一次性material confirmation、完整可列印報告與Privacy／Terms／Cookie DRAFT頁。
- 完成`listing → evidence → contract → report`固定Pipeline contracts、Evidence Graph、三態truth table、成本模型、6條P0官方規則、FRS-001、deterministic report及Golden truth整合測試。
- 完成OpenAI Responses adapters：Luna conversation為`gpt-5.6-luna`＋low；Listing／Evidence／Contract／Interaction為`gpt-5.6-terra`＋medium；全部固定`service_tier: default`、`store: false`、strict object-root schema、無tools與typed errors。Fixture不靜態import或呼叫Live adapter。
- 完成Conversation與Evidence分離budget、attempt／usage reconcile、unknown usage fail closed、idempotency、case concurrency、Actor／保守source bucket rate gates及provider failure不記成功。
- 完成JPEG／PNG stream guard與Sharp sanitizer、文字PDF的PDF.js active-content Gate與逐頁locator；修正Buffer／fake-worker production integration後，實際Golden PDF上傳回2頁／860字元receipt。
- 新增`POST /uploads`與`POST /analysis-runs`：只接受manifest allowlist的sealed synthetic bytes；Fixture analysis只讀外部fallback、不讀truth且不呼叫OpenAI，建立Snapshot後可開啟報告。
- 新增exact Host／Origin／CSRF gates、bounded UTF-8 bodies、auth-secret hard block、prompt-injection fixed responses、confirmation TTL／hash／CSRF／CAS、Demo trust anchor、TOCTOU hash recheck與truth／fallback browser exposure拒絕。
- 新增Windows LAN exact RFC1918／Private-only／Firewall管理與preflight工具；LAN每次啟動另需操作者明確確認沒有Port Forwarding、UPnP exposure與Tunnel。Public profile持續fail closed。
- 新增可執行`security:check`：SDK依賴邊界、client secrets、PII／private key、Demo素材、lockfile、LICENSE政策、Fixture／Live imports與server／browser source maps；修正`.gitignore`避免排除`src/**/uploads`。
- 新增第三方套件授權盤點；移除未使用的Radix Dialog dependency。Repository仍維持沒有專案LICENSE。
- 使用者已以系統管理員完成Node.js升級；`node --version`、`.node-version`與`package.json` engines現皆對齊24.20.0 LTS。
- 依使用者要求將pnpm由11.19.0升級至npm latest stable 11.25.0；Corepack global shim、`packageManager`／engines皆已同步，`pnpm install --frozen-lockfile`通過。

### 驗證

- `pnpm format:check`：通過。
- `pnpm lint`：通過，0 warnings。
- `pnpm typecheck`：通過。
- `pnpm test`：66 files／676 tests通過；外部Golden PDF與18-file truth為實際執行、非skip。
- `pnpm test:coverage`：66 files／676 tests通過；Statements 95.01%、Branches 91.83%、Functions 97.43%、Lines 95.92%，所有module thresholds通過。
- `pnpm build`：Next.js 16.3.4 Production Build通過，7個static pages與6個dynamic API route patterns；build無trace warning。
- `pnpm test:e2e`：Desktop／Pixel 7合計10 passed、2個預期mobile singleton mutation tests skipped；涵蓋sealed artifact、政策、confirmation、upload→PDF.js／Sharp→Fixture analysis→report、Tabs、RWD與Axe。
- `pnpm security:check`：通過，309 files inventoried；`.next/server`與`.next/static` source maps皆0。
- `pnpm audit --prod --audit-level=high`：No known vulnerabilities found。
- 全程未執行Git、未建立repository／remote、未呼叫OpenAI Live API、未建立Production auth／database。

### 尚未完成／外部阻擋

- 目前Wi-Fi `172.16.102.98`為Windows Public profile；未改成Private、未安裝／啟用Firewall rule，也未做手機LAN smoke。這是刻意的安全阻擋，不自動改變整台Windows的網路信任層級。
- OpenAI Development Project的US$50／US$80 alerts、US$100 hard limit、Luna／Terra rate limits、scoped key與Live eval仍需Dashboard權限；`.env.local`金鑰保持空白。Terra requests與Pipeline已完成，但`analysis-runs`目前刻意Fixture-only，未經Live eval不啟用。
- Source-IP在原生Next Route Handler無可信socket資訊且不信任Client forwarding header；P0採全LAN共享的保守bucket，可能互相限流但不能被偽造header繞過。Production需由選定reverse proxy提供可信remote address後再改為per-IP。
- 帳戶、Clerk、PostgreSQL、HTTPS與真實資料仍屬first real-data release，未在HTTP P0提前啟用。

### 下一步

1. 由使用者決定是否將目前Wi-Fi設為Private；若同意，再以獨立管理腳本InstallDisabled／Enable，做手機LAN smoke並在Demo後Disable。
2. 由使用者在OpenAI Development Project完成spend／rate limits並將scoped key只寫入`.env.local`，再執行Luna與Terra Live eval；未通過前保持Fixture。

---

## 2026-09-02 — P0 Scaffold與Conversation Fixture API

### 本次目標

- 建立可執行的Windows／pnpm／Next.js P0環境與conversation-first第一個垂直切片，全程不使用Git。

### 已完成

- 由三個Sub-agent並行完成Scaffold相容性、Conversation contracts與Security Gate審查；Sub-agent均未修改檔案或使用Git。
- 建立exact-version`package.json`、`pnpm-lock.yaml`、pnpm supply-chain build allowlist、Node target、Next／TypeScript／ESLint／Prettier／Vitest／Playwright／Tailwind設定。
- 安裝Next.js 16.3.4、React 19.2.8、TypeScript 6.0.3、pnpm 11.19.0相依環境與Playwright Chromium；只允許`sharp`與經檢查的`unrs-resolver`build scripts。
- 建立`.env.local`Fixture設定且API key為空；NTFS ACL移除inheritance，保留使用者／SYSTEM／Administrators full與CodexSandboxUsers read。
- 建立validated Next launcher，明確傳入host／port，local只允許`127.0.0.1`，拒絕wildcard／錯誤model route／Live missing key。
- 建立conversation-first RWD頁面、HTTP／synthetic warning、2,000 code-point composer、Candidate／Finding cards與四區Evidence Workspace。
- 建立Conversation Domain schemas：limits、typed material candidates、strict intent union、focus state、assistant segments／cards、confirmation及closed error codes。
- 建立8 KiB streaming／fatal UTF-8／NUL／NFC／2,000-code-point normalizer、三態comparison核心與tests。
- 建立`POST /api/cases/[caseId]/conversation/turns`：Host／Origin／content-type／forwarded header Gate、bounded streaming、idempotency payload hash、Fixture-only response與`private, no-store`。
- 前端可實際送出自由文字並解析AssistantTurn schema；provider／schema failure保留草稿且不顯示成功。
- 依Next 16內建文件修正App Router／CSS／Route Handler／ESLint實作；保留Next自動加入的agent rules。
- 修正`.env.example`模型分流、Demo version、README Demo path、Server artifact allowlist與Security Luna／Terra route漂移。
- 瀏覽器人工檢查發現Desktop sticky composer遮擋後，改為只在Mobile sticky；Axe發現heading level跳級後修正。

### 驗證

- `pnpm format:check`：通過。
- `pnpm lint`：通過，0 warnings。
- `pnpm typecheck`：通過。
- `pnpm test`：4 files／14 tests通過。
- `pnpm test:coverage`：Statements 96.92%、Branches 86.95%、Functions 93.33%、Lines 100%。
- `pnpm build`：通過；`/`為static page，Conversation Route為dynamic Node route。
- `pnpm test:e2e`：Desktop Chromium與Pixel 7兩個project通過，包含實際Fixture API、無水平overflow與Axe violations=0。
- `pnpm audit --prod --audit-level=high`：No known vulnerabilities found。
- 手動`curl`驗證Forwarded header mismatch拒絕；Next internal same-host forwarded metadata允許後，Fixture turn回200與strict AssistantTurn。
- 發現`next build`與`tsc`並行時會競態重建`.next/types`；改為Build完成後序列執行Typecheck，驗證通過。CI不得平行執行這兩項。
- 全程未執行任何Git指令，未建立OpenAI key、未呼叫OpenAI API、未建立Production auth／database。

### 尚未完成／風險

- 官方Node最新24 LTS為24.20.0，專案`.node-version`已鎖定；目前系統`C:\Program Files\nodejs`仍回24.13.0。使用者已授權升級，但官方MSI被Windows Installer以Error 1925／insufficient privileges拒絕；需由使用者以系統管理員權限安裝。現有24.x已通過全部本次Gate。
- Conversation API目前只有Fixture、in-memory idempotency，尚未實作Actor／IP token bucket、PII／auth-secret detector、payload-bound acknowledgement、confirmation repository、runtime persistence或Luna adapter。
- Demo manifest／external Golden assets與runtime path helper尚未建立；目前首頁使用程式內synthetic view model。
- LAN Firewall enable／disable scripts與真實手機LAN smoke尚未實作；目前僅loopback。
- Coverage目前是第一切片global門檻，尚未完成文件要求的所有module glob thresholds與完整Conversation security cases。

### 下一步

1. 實作Conversation transport的Actor／IP token bucket、PII／auth-secret Gate、10-minute acknowledgement與confirmation repository ports。
2. 建立External Demo manifest schema／read-only adapter與`golden-v1`人工truth，不把素材放進repository。
3. 擴充Golden三態／FRS-001／report composer及module-level coverage Gate。

---

## 2026-09-02 — Luna Project Limit 30 RPM／500K TPM

### 已完成

- 使用者選擇Development Luna Project 30 RPM／500K TPM／300 RPD（若Dashboard支援）。
- 新增D-088，同步README、AGENTS、OpenAI Integration、Technical Design與Implementation Plan。
- 定義Application較嚴限制優先、低Tier採低值、無RPD欄位明示、禁止升Tier／拆Project／換key規避及Production分離。

### 尚未完成

- 尚未在OpenAI Dashboard設定或驗證Luna limit；Luna Live eval門檻仍待決定。

### 驗證

- 本次只更新規格文件；未修改OpenAI Project，也未執行Git。

---

## 2026-09-02 — Conversation Budget改為寬鬆方案

### 已完成

- 使用者將Conversation Budget由選項1改為選項3。
- 新增D-087並將D-086標為superseded；同步README、AGENTS、OpenAI Integration、System Architecture、Technical Design與Implementation Plan。
- 現行數值為每case／fixed 24h 200 Luna calls、500K input、100K output＋reasoning、concurrency 1、US$0.50 engineering alert；其他reserve／reconcile／no-fallback規則不變。

### 尚未完成

- 尚未建立ConversationBudgetRepository或cost metrics；Development Luna Project rate limit仍待決定。

### 驗證

- 本次只修正規格文件；未建立budget或呼叫OpenAI API，也未執行Git。

---

## 2026-09-02 — Conversation Luna Balanced Budget

### 已完成

- 使用者選擇每case／fixed 24h Conversation Budget：100 Luna calls、250K input、50K output＋reasoning、concurrency 1、US$0.25 alert。
- 新增D-086，同步README、AGENTS、OpenAI Integration、System Architecture、Technical Design與Implementation Plan。
- 定義分離Evidence／Conversation budget、non-sliding window、atomic reserve／usage reconcile、unknown usage與hard-cap後Server-only降級但不切Terra。

### 尚未完成

- 尚未建立ConversationBudgetRepository、reservation／reconcile或cost metrics；Development Luna Project rate limit仍待決定。

### 驗證

- 本次只更新規格文件；未建立budget或呼叫OpenAI API，也未執行Git。

---

## 2026-09-02 — Conversation Luna／Evidence Terra

### 已完成

- 使用者選擇Conversation intent／explanation使用`gpt-5.6-luna`＋low，Evidence extraction使用`gpt-5.6-terra`＋medium。
- 新增D-085並將D-016標為superseded；同步README、AGENTS、OpenAI Integration、System Architecture、Technical Design與Implementation Plan。
- 依OpenAI官方模型定位／價格定義route allowlist、分離config／eval／provenance與禁止自動升級／降級fallback；D-037 budget保留給Evidence。

### 尚未完成

- 尚未建立route config、Luna schemas／eval或usage buckets；Conversation provider budget仍待決定。

### 驗證

- 本次只更新規格並查核OpenAI官方Luna／Terra頁面；未呼叫API，也未執行Git。

---

## 2026-09-02 — Assistant採Hybrid Response

### 已完成

- 使用者選擇Server safety templates＋LLM read-only explanation的Hybrid回覆。
- 新增D-084，同步README、AGENTS、Product、UI、Technical Design、OpenAI Integration、Security與Implementation Plan。
- 定義Server-only response kinds、source-bound explanation segments、same-snapshot／forbidden-action validation及provider failure的固定安全template。

### 尚未完成

- 尚未建立AssistantResponseComposer、ExplanationGenerator schema／adapter或semantic eval；Conversation model routing仍待決定。

### 驗證

- 本次只更新規格文件；未生成assistant response或呼叫OpenAI API，也未執行Git。

---

## 2026-09-02 — Raw Conversation Text保存7天

### 已完成

- 使用者選擇raw user／assistant text固定保存7天，typed case events持續保留。
- 新增D-083，同步README、AGENTS、Product、UI、Auth、Privacy、Technical Design、Security與Implementation Plan。
- 定義7天non-sliding、24h online purge、較短guest／Demo／delete優先、無excerpt／embedding／reversible hash及backup retention tombstone replay。

### 尚未完成

- 尚未建立RawConversationContent／ConversationEvent storage separation、purge job或restore tests；assistant response生成策略仍待決定。

### 驗證

- 本次只更新規格文件；未保存或清除聊天文字，也未執行Git。

---

## 2026-09-02 — LAN一般PII警告後允許送出

### 已完成

- 使用者選擇LAN疑似一般PII只警告、仍可明確送出。
- 新增D-082，同步README、AGENTS、Product、UI、Server Configuration、OpenAI Integration、Security、Demo Test Plan與Implementation Plan。
- 定義client pre-warning、Server payload-bound 10-minute acknowledgement及HTTP剩餘風險；auth／recovery secrets、tokens、完整金融帳號與QR仍維持不可繞過hard block。

### 尚未完成

- 尚未建立PII／secret detector、warning acknowledgement或false-positive tests；raw conversation history是否持久化仍待決定。

### 驗證

- 本次只更新規格文件；未偵測、保存或傳送任何PII／secret，也未執行Git。

---

## 2026-09-02 — Model Context不傳Raw Chat History

### 已完成

- 使用者選擇模型只接收目前turn、Server structured state與validated focus refs。
- 新增D-081，同步README、AGENTS、Product、UI、Technical Design、OpenAI Integration、Security與Implementation Plan。
- 定義focus actor／case／snapshot驗證、ambiguous clarification、context version／hash provenance及UI history與model context權限分離。

### 尚未完成

- 尚未建立ServerConversationState／FocusRef schemas、resolver或tests；LAN PII命中後的阻擋策略仍待決定。

### 驗證

- 本次只更新規格文件；未傳送conversation context或呼叫OpenAI API，也未執行Git。

---

## 2026-09-02 — Material Confirmation有效10分鐘

### 已完成

- 使用者選擇Material Candidate confirmation有效10分鐘。
- 新增D-080，同步README、AGENTS、Product、UI、Technical Design、Security與Implementation Plan。
- 定義opaque one-time ID、actor／case／revision／type／payload binding、CSRF／Origin、atomic consume與expired／stale／used分離；高影響動作仍需reverification。

### 尚未完成

- 尚未建立PendingConfirmation repository、canonical payload hash或atomic tests；Conversation context策略仍待決定。

### 驗證

- 本次只更新規格文件；未建立或消耗confirmation，也未執行Git。

---

## 2026-09-02 — Assistant回覆600字／3 Cards

### 已完成

- 使用者選擇assistant單次narrative最多600 Unicode code points、最多3張typed cards。
- 新增D-079，同步README、AGENTS、Product、UI、Technical Design、OpenAI Integration與Implementation Plan。
- 定義deterministic安全優先排序、remaining count／workspace CTA、snapshot refs與超限不截斷／typed error；完整report不受限制。

### 尚未完成

- 尚未建立assistant output schema、composer或tests；material candidate confirmation有效時間仍待決定。

### 驗證

- 本次只更新規格文件；未生成或截斷assistant回覆、未呼叫OpenAI API，也未執行Git。

---

## 2026-09-02 — Conversation Rate 10／Minute、Burst 3

### 已完成

- 使用者選擇每Actor每分鐘10則、burst 3、每case concurrency 1，並疊加來源IP bucket。
- 新增D-078，同步README、AGENTS、Product、UI、Technical Design、OpenAI Integration、Security與Implementation Plan。
- 定義idempotency actor／case／payload binding、duplicate reuse、conflict reason code、429 Retry-After及limiter失效Live fail-closed。

### 尚未完成

- 尚未實作token bucket、idempotency store或concurrency lock；assistant output上限仍待決定。

### 驗證

- 本次只更新規格文件；未限流或呼叫OpenAI API，也未執行Git。

---

## 2026-09-02 — Conversation Turn上限2,000字／8 KiB

### 已完成

- 使用者選擇單則free-text上限NFC後2,000 Unicode code points且raw UTF-8最多8 KiB。
- 新增D-077，同步README、AGENTS、Product、UI、Technical Design、OpenAI Integration、Security與Implementation Plan。
- 定義streaming byte cap、strict UTF-8／NUL、NFC code-point計數、不截斷／不保存／不呼叫模型及attachment boundary。

### 尚未完成

- 尚未實作stream reader、Unicode counter、typed errors或tests；turn rate與assistant output上限仍待決定。

### 驗證

- 本次只更新規格文件；未接收或截斷文字、未呼叫OpenAI API，也未執行Git。

---

## 2026-09-02 — LAN全面Free Text＋Prompt Injection隔離

### 已完成

- 使用者選擇LAN全面開放自由文字，並要求防範Prompt Injection。
- 新增D-076，同步AGENTS、Product、UI、System Architecture、Server Configuration、OpenAI Integration、Security、Demo Test Plan與Implementation Plan。
- 依OpenAI官方Responses／Structured Outputs行為，定義`tools: []`、最小context、strict schema、Server allowlist、opaque confirmation actor／revision／hash／expiry及conversation／document prompt分離。
- 明確記錄LAN HTTP與無法保證synthetic／PII偵測的剩餘風險；manifest外artifact與Production能力仍禁止。

### 尚未完成

- 尚未實作free-text、PII patterns、intent schema、confirmation store或prompt-injection eval；turn大小與rate上限仍待決定。

### 驗證

- 本次只更新規格文件並查核OpenAI官方文件；未接收文字、未呼叫OpenAI API，也未執行Git。

---

## 2026-09-02 — Conversation改為Free-text-first

### 已完成

- 使用者選擇自由文字作為Conversation主要輸入方式。
- 新增D-075，同步README、AGENTS、Product、UI、System Architecture、Technical Design、Security與Implementation Plan。
- 定義free-text只產生strict typed intent／fact candidates、material confirmation、ambiguous clarification、無tools／stage權限及IME／重複送出安全需求。

### 尚未完成

- 尚未實作free-text composer或intent extractor；P0 LAN synthetic-only與arbitrary text的衝突仍待下一決策，未解決前不得開啟LAN free-text ingestion。

### 驗證

- 本次只更新規格文件；未接收文字、未呼叫LLM，也未執行Git。

---

## 2026-09-02 — Conversation-first操作架構

### 已完成

- 使用者選擇對話為主要操作方式，四區Evidence Workspace作為輔助結構檢視。
- 新增D-074，同步README、AGENTS、Product、UI、System Architecture、Technical Design、Security、Auth與Implementation Plan。
- 定義typed candidate／confirmation gate、固定case state machine、snapshot一致性與conversation不作domain真相／自治Agent／列印報告來源。

### 尚未完成

- 尚未建立conversation schemas、state machine、components或tests；P0自由文字與quick reply的輸入範圍仍待決定。

### 驗證

- 本次只更新規格文件；未建立UI或呼叫LLM，也未執行Git。

---

## 2026-09-02 — Development OpenAI Key使用`.env.local`

### 已完成

- 使用者選擇Windows Development OpenAI key保存於repo-root `.env.local`。
- 新增D-073，同步README、AGENTS、OpenAI Integration、Server Configuration、Security與Implementation Plan。
- 定義ignore、NTFS ACL、blank example與secret scan，以及Fixture不讀key／不組裝Live adapter／不發網路的邊界。

### 尚未完成

- 尚未Scaffold、建立`.env.local`／`.env.example`或設定API key；也尚未執行ACL／bundle secret scan。

### 驗證

- 本次只更新規格文件；未建立或讀取secret，也未執行Git。

---

## 2026-09-02 — Golden Version由環境變數顯式指定

### 已完成

- 使用者選擇以必填`RENTPROOF_DEMO_CASE_VERSION`指定Golden版本。
- 新增D-072，同步README、AGENTS、System Architecture、Server Configuration、Technical Design、Demo Test Plan與Implementation Plan。
- 定義嚴格`golden-vN`segment、filesystem lookup前拒絕path／latest／encoding，以及version／manifest hash進provenance但不揭露absolute path。

### 尚未完成

- 尚未建立env schema、resolver或launcher；Windows開發OpenAI API Key保存方式仍待決定。

### 驗證

- 本次只更新規格文件；未設定環境變數、未讀取Demo資料，也未執行Git。

---

## 2026-09-02 — Manifest使用Strict JSON＋Zod／JSON Schema

### 已完成

- 使用者選擇Demo manifest使用JSON＋Zod／JSON Schema。
- 新增D-071，同步README、AGENTS、System Architecture、Technical Design、Demo Test Plan與Implementation Plan。
- 定義raw-byte SHA-256 seal、strict unknown validation、1 MiB／100 entries上限與Windows path collision／traversal安全規則。

### 尚未完成

- 尚未建立Zod／JSON Schema、manifest writer或fixture；Golden版本選擇機制仍待決定。

### 驗證

- 本次只更新規格文件；未解析或寫入JSON，也未執行Git。

---

## 2026-09-02 — Demo使用Immutable Version＋Manifest Hash

### 已完成

- 使用者選擇Demo素材以不可變`cases/golden-vN`資料夾、manifest檔案hash與sidecar seal管理。
- 新增D-070，同步README、AGENTS、System Architecture、Technical Design、Demo Test Plan與Implementation Plan。
- 定義sealed版本不得覆寫、App顯式選版、missing／extra／mismatch fail closed，以及人工truth與分析fallback分離。

### 尚未完成

- 尚未建立`RentProof-Demo`或`golden-v1`；manifest實際格式與schema仍待決定。

### 驗證

- 本次只更新規格文件；未建立或修改Demo素材，也未執行Git。

---

## 2026-09-02 — Demo預設放在Windows使用者目錄

### 已完成

- 使用者選擇外部Demo資料夾預設`%USERPROFILE%\RentProof-Demo`，文件與程式不硬編碼本機使用者名稱。
- 新增D-069，同步README、AGENTS、System Architecture、Server Configuration、Technical Design與Implementation Plan。
- 定義目錄需預先存在且App只讀、缺失明確報錯、不得自動建立／複製／初始化Git，以及path overlap／reparse／sync拒絕。

### 尚未完成

- 尚未建立或檢查該資料夾，也未製作Demo素材；素材版本管理方式仍待決定。

### 驗證

- 本次只更新規格文件；未建立外部目錄，也未執行Git。

---

## 2026-09-02 — Development Runtime 7天／Formal Demo結束清除

### 已完成

- 使用者選擇Development runtime最後寫入後最多保留7天，Formal Demo run結束即清除。
- 新增D-068，同步README、AGENTS、System Architecture、Server Configuration、Technical Design、Security與Implementation Plan。
- 定義獨立run、manifest／lock／active marker、abandoned cleanup及刪除前path／ownership重驗，避免誤刪root、repository或Demo。

### 尚未完成

- 尚未實作runtime manifest、cleanup job或crash recovery，也未執行實際刪除測試。

### 驗證

- 本次只更新規格文件；未建立或刪除Runtime資料，也未執行Git。

---

## 2026-09-02 — Windows Runtime使用LocalAppData

### 已完成

- 使用者選擇P0 runtime預設`%LOCALAPPDATA%\RentProof\runtime`。
- 新增D-067，同步README、AGENTS、System Architecture、Server Configuration、Technical Design、Security與Implementation Plan。
- 定義安全覆寫與fail-closed path／ACL規則，拒絕repository／Demo／public／同步目錄、UNC／network、removable與reparse path，且不fallback到TEMP／cwd。

### 尚未完成

- 尚未建立config resolver、runtime目錄或ACL測試；runtime清理期限仍待決定。

### 驗證

- 本次只更新規格文件；未建立或清除LocalAppData資料，也未執行Git。

---

## 2026-09-02 — Firewall Rule保留但預設停用

### 已完成

- 使用者選擇LAN Demo Firewall Rule保留但平時disabled，只在Demo前後切換。
- 新增D-066，同步README、AGENTS、Server Configuration、Security與Implementation Plan。
- 定義elevated管理腳本不得啟動Node、App維持standard user，以及preflight／異常恢復需檢查stale enabled rule。

### 尚未完成

- 尚未建立Rule、管理腳本或preflight；實際命令與rule name需在Scaffold後驗證再記錄。

### 驗證

- 本次只更新規格文件；未修改Firewall、未提升權限，也未執行Git。

---

## 2026-09-02 — Firewall允許整個Private Network

### 已完成

- 使用者選擇LAN Demo Firewall允許整個Windows Private Network來源。
- 新增D-065，同步README、AGENTS、System Architecture、Server Configuration、Security與Implementation Plan。
- 保留指定LAN IP／port、Public／Domain profile拒絕、無Router forwarding、synthetic-only與rate-limit安全邊界，並明確記錄同網段非展示裝置可存取的風險。

### 尚未完成

- 尚未建立或測試Windows Firewall rule；規則永久存在或僅Demo期間啟用仍待決定。

### 驗證

- 本次只更新規格文件；未修改Firewall，也未執行Git。

---

## 2026-09-02 — Dev Server開發＋Production Build正式Demo

### 已完成

- 使用者選擇日常開發使用Next Dev Server，正式Demo使用Production Build＋`lan_development`安全profile。
- 新增D-064，同步README、AGENTS、System Architecture、Server Configuration、Technical Design、Implementation Plan與Demo Test Plan。
- 修正`NODE_ENV=production`與`lan_development`的衝突：Next最佳化模式不再等同RentProof Production能力。

### 尚未完成

- 尚未Scaffold、建立build／start scripts或實際掃描source maps／HMR；具體pnpm指令需在可執行後補回文件。

### 驗證

- 本次只更新規格文件；未執行Next build／server，也未執行Git。

---

## 2026-09-02 — P0使用原生Node.js＋pnpm啟動

### 已完成

- 使用者選擇Development／Demo以原生Node.js 24＋pnpm直接啟動Next.js。
- 新增D-063，同步README、AGENTS、Server Configuration、Technical Design與Implementation Plan。
- 明確排除P0的Docker、WAMP／Apache proxy、IIS與Windows Service，並要求validated launcher實際傳遞host／port且不以Administrator執行。

### 尚未完成

- 尚未Scaffold或建立pnpm scripts／launcher；正式Demo使用dev server或production build仍待決定。

### 驗證

- 本次只更新規格文件；未啟動Node、未變更Firewall，也未執行Git。

---

## 2026-09-02 — Windows桌面Dev／Demo；Production OS暫緩

### 已完成

- 使用者確認Development／Demo使用目前Windows桌面電腦，並要求Production OS暫不決定。
- 新增D-062，同步README、AGENTS、System Architecture、Server Configuration、Technical Design、Implementation Plan及Sharp平台說明。
- 明確維持Windows HTTP LAN synthetic-only，並禁止在P0提前加入Windows Server／Linux／systemd／reverse proxy假設。

### 尚未完成

- 尚未Scaffold或驗證Windows path／NTFS／Firewall；Production OS、service wrapper、reverse proxy與TLS均延後。

### 驗證

- 本次只更新規格文件；未修改Windows服務或Firewall，也未執行Git。

---

## 2026-09-02 — Production App與PostgreSQL同機

### 已完成

- 使用者選擇Production App與PostgreSQL部署在同一台Server。
- 新增D-061，同步README、AGENTS、System Architecture、Server Configuration、Technical Design與Implementation Plan。
- 定義DB只聽loopback／local socket、禁止公開DB port、角色／OS權限分離，以及off-host加密backup不可省略；明確不宣稱HA。

### 尚未完成

- 尚未選擇Production Server OS、off-host storage或RPO／RTO，也未安裝PostgreSQL或建立roles／firewall rules。

### 驗證

- 本次只更新架構文件；未連線或修改Server／Database，也未執行Git。

---

## 2026-09-02 — Security／Deletion Audit保存180天

### 已完成

- 使用者選擇最小化security／deletion audit events保存180天，到期後24小時內purge。
- 新增D-060，同步README、AGENTS、Auth、Security、Privacy與Implementation Plan。
- 定義audit欄位allowlist與禁止內容，並與21天deletion tombstone分離，禁止用audit恢復案件。

### 尚未完成

- 尚未實作audit store、RBAC、expiry job或完整event catalog；Production PostgreSQL部署拓撲仍待決定。

### 驗證

- 本次只更新規格文件；未建立audit event或刪除資料，也未執行Git。

---

## 2026-09-02 — Backup 14天與Deletion Tombstone 21天

### 已完成

- 使用者選擇加密backup／PITR最多保存14天，最小化deletion tombstone保存21天。
- 新增D-059，同步README、AGENTS、Auth、Security、Privacy與Implementation Plan。
- 定義backup僅供災難復原、不可供客服／一般查詢，以及restore需隔離、重播tombstones並驗證後才可開放流量。

### 尚未完成

- 尚未選擇支援上述控制的database／object provider，也未執行restore演練；security／deletion audit保存期限仍待決定。

### 驗證

- 本次只更新規格文件；未建立、還原或刪除任何backup，也未執行Git。

---

## 2026-09-02 — 帳戶案件刪除後7天內線上清除

### 已完成

- 使用者選擇帳戶案件／帳戶刪除後立即停止存取，並於7個日曆日內完成線上purge。
- 新增D-058，同步README、AGENTS、UI、Auth、Security、Privacy與Implementation Plan。
- 定義不可恢復、per-target冪等重試／狀態、SLA告警與未完成不得宣稱完全刪除；Guest維持24小時SLA。

### 尚未完成

- 尚未實作purge workflow或第三方刪除驗證；backup期限、deletion tombstone與security audit期限仍待決定。

### 驗證

- 本次只更新規格文件；未刪除任何資料，也未執行Git。

---

## 2026-09-02 — 改為帳戶案件保存至使用者刪除

### 已完成

- 使用者將帳戶案件保存選擇由24個月改為保存至使用者刪除案件或帳戶。
- 新增D-057並將D-056標為superseded；同步README、AGENTS、Product、UI、Auth、Security、Privacy與Implementation Plan。
- 移除目前規格中的24個月retention anchor、30天通知與延長保存按鈕，保留明確刪除控制及刪除後立即deny要求。

### 尚未完成

- 尚未實作案件／帳戶刪除workflow；線上purge SLA、backup與必要audit retention仍待決定。

### 驗證

- 本次只修正規格文件；未建立或刪除資料、未寄送通知，也未執行Git。

---

## 2026-09-02 — 帳戶案件保存24個月與30天通知

### 已完成

- 使用者選擇User-owned case自最後合格有效異動保存24個月，並在到期前30天通知。
- 新增D-056，同步README、AGENTS、Product、UI、Auth、Security、Privacy與Implementation Plan。
- 定義可延長期限的合格異動；瀏覽、下載、prefetch／polling、retry與背景處理不得延長。

### 尚未完成

- 尚未實作retention anchor、通知或到期workflow；到期／手動刪除後的線上purge SLA與backup期限仍待決定。

### 驗證

- 本次只更新規格文件；未寄送通知、未建立或刪除資料，也未執行Git。

---

## 2026-09-02 — Guest固定24小時與24小時Purge SLA

### 已完成

- 使用者選擇Guest Session自建立起固定24小時，到期後24小時內清除線上案件資料。
- 新增D-055，同步README、AGENTS、Product、Auth、Security、Privacy、Cookie與Implementation Plan。
- 明確定義non-sliding expiry、到期立即deny、停止未完成工作，以及只有明確原子transfer才能改採帳戶保存政策。

### 尚未完成

- 尚未實作guest cookie、purge worker或第三方刪除驗證；帳戶案件與backup保存期限仍待決定。

### 驗證

- 本次只更新規格文件；未建立或刪除任何使用者資料，也未執行Git。

---

## 2026-09-02 — Production migration採Forward-only＋Expand／Contract

### 已完成

- 使用者選擇Production forward-only＋expand／contract，不在正式環境執行`down`。
- 新增D-054，同步README、AGENTS、Technical Design與Implementation Plan。
- 定義expand、相容Application／可重入backfill、驗證與後續contract的分段流程；整庫restore只作incident最後手段。

### 尚未完成

- 尚未建立migration或backup／PITR演練；真實資料版database provider與連線政策仍未決定。

### 驗證

- 本次只更新架構文件；未連線或修改任何資料庫，也未執行Git。

---

## 2026-09-02 — PostgreSQL migration選用Kysely Migrator

### 已完成

- 使用者選擇Kysely Migrator管理first real-data release的PostgreSQL schema。
- 新增D-053，同步README、AGENTS、Technical Design與Implementation Plan。
- 明確要求migration檔案版本化且不可回頭修改，不依賴當前Domain／Application code，並禁止Web process自動migrate。

### 尚未完成

- 尚未建立migration runner、migration table或資料庫；Production rollback／expand-contract政策仍待決定。

### 驗證

- 本次只更新架構文件；未安裝Kysely、未連線PostgreSQL，也未執行Git。

---

## 2026-09-02 — PostgreSQL adapter選用Kysely＋node-postgres

### 已完成

- 使用者選擇Kysely＋node-postgres作為first real-data release的PostgreSQL adapter。
- 新增D-052，同步README、AGENTS、Technical Design與Implementation Plan。
- 明確維持P0記憶體／JSON state，並限制Kysely／`pg`只能由infrastructure adapter import。

### 尚未完成

- 尚未安裝套件、建立PostgreSQL schema、connection pool或migration；migration策略仍待決定。

### 驗證

- 本次只更新架構文件；未連線資料庫、未執行套件安裝，也未執行Git。

---

## 2026-09-02 — Account Session完全使用Clerk

### 已完成

- 使用者選擇完全使用Clerk Hobby固定7天Session，不建立RentProof account session DB／token。
- 新增D-051並將D-024標為superseded；同步README、AGENTS、Auth、System、Technical、安全、Cookie、Privacy、Terms與實作計畫。
- PostgreSQL仍保存Internal User、Clerk mapping、Owner、Policy與Audit，但不保存credentials或Clerk session token。

### 尚未完成

- 尚未建立Clerk instance／adapter或PostgreSQL schema，固定7天Session行為與revoke／reset tests尚未驗證。

### 驗證

- 本次未建立Session或資料表、未保存Auth資料，也未執行Git。

---

## 2026-09-02 — Clerk Hobby初期Email-only Recovery

### 已完成

- 使用者選擇初期只使用Email重設密碼，SMS Recovery延後。
- 新增D-050並將D-022標為被Clerk／Email-only決策取代；同步README、AGENTS、產品、Auth、UI、安全、Privacy、Terms與實作計畫。
- 初期不蒐集phone、不顯示SMS UI、不配置外部SMS Provider。

### 尚未完成

- 尚未建立Clerk Email流程；Hobby固定7天Session與既有sliding需求仍待下一決策。

### 驗證

- 本次未收集電話、未發送Email／SMS，也未執行Git。

---

## 2026-09-02 — Clerk Hobby方案

### 已完成

- 使用者選定Development與初期Production都使用Clerk Hobby。
- 依Clerk官方價格核對50,000 MRU、固定7天Session、1-day Logs，以及Production SMS／MFA／Custom Session Lifetime不包含在Hobby。
- 新增D-049，並同步AGENTS、Auth、Privacy與實作計畫。

### 尚未完成／風險

- 尚未建立Clerk instance。SMS recovery與7天sliding-session需求和Hobby能力衝突，後續決策完成前Production Gate關閉。

### 驗證

- 本次未訂閱Pro、未建立Clerk帳戶或Session，也未執行Git。

---

## 2026-09-02 — Clerk Password Reset後重新登入

### 已完成

- 使用者選擇Clerk reset成功後立即撤銷Reset Session，不保留auto-login。
- 新增D-048，並同步AGENTS、Auth、安全、UI與實作計畫。
- Reset task／session不建立RentProof ActorContext；撤銷其他與當前session後只導回一般登入。

### 尚未完成

- 尚未建立Clerk custom flow、Backend revoke、Cookie clear、race／replay／fail-closed tests。

### 驗證

- 本次未建立Clerk session、未發送Reset Code，也未執行Git。

---

## 2026-09-02 — Identity Provider：Clerk

### 已完成

- 使用者選定Clerk作第一個真實資料版本的Identity Provider。
- 核對Clerk Next.js App Router server auth、Email／Phone forgot-password flow與session revocation能力。
- 新增D-047，並同步README、AGENTS、Auth、System、Technical、Privacy與實作計畫。
- 固定Clerk SDK只進Infrastructure adapter，RentProof owner authorization仍在Server repository layer。

### 尚未完成

- 尚未選Clerk plan／data region／messaging設定，未建立instance或keys；Password reset後auto-login衝突與7天session實際設定尚待決定。

### 驗證

- 本次未安裝Clerk SDK、未建立帳戶、未傳送Email／SMS，也未執行Git。

---

## 2026-09-02 — P0暫時只在本機／LAN展示

### 已完成

- 使用者選擇暫時不部署公開預覽，只使用local／trusted private LAN與備用錄影。
- 新增D-046並將D-045標為superseded；同步README、AGENTS、產品、Server、系統、技術與實作計畫。
- `public_http_showcase`規格保留但標記disabled，不建立VPS、Port Forwarding或Public Build。

### 尚未完成

- 尚未Scaffold或執行實體LAN smoke；公開Showcase Hosting不在目前範圍。

### 驗證

- 本次未部署網站、未修改Firewall／Router，也未執行Git。

---

## 2026-09-02 — Public HTTP Static Showcase

### 已完成

- 使用者選擇公開唯讀Synthetic Showcase，但不使用HTTPS。
- 新增D-045與`public_http_showcase`profile，並同步README、AGENTS、產品、Server、系統、UI、安全、Auth、政策、技術、Demo與實作文件。
- 固定Showcase為static export，無server／API／upload／OpenAI key／auth／Cookie／form／browser storage／service worker／source map，persistent integrity warning＋noindex。
- Production仍強制HTTPS；Showcase HTTP例外不得進入正式產品。

### 尚未完成

- 尚未Scaffold或Build static export，尚未選Hosting／HTTP static server，也未執行bundle／network／MITM warning tests。

### 驗證

- 文件已明確說明HTTP不能保證內容完整性，Showcase不可作正式證據或接收敏感資料。
- 本次沒有部署網站、沒有開放公網，也未執行Git。

---

## 2026-09-02 — Repository維持沒有License

### 已完成

- 使用者選擇公開Repository維持沒有開源License。
- 新增D-044，並同步README、AGENTS、使用條款與實作計畫；已從尚待決定表移除開源授權。
- 規劃Scaffold後設定`package.json.private=true`，第三方License／Notice另行盤點。

### 尚未完成

- 尚未Scaffold，因此package private flag與第三方授權清單尚未建立；尚未設Contributor terms。

### 驗證

- 本次未建立或刪除LICENSE，未接受外部貢獻，也未執行Git。

---

## 2026-09-02 — Vitest V8 Coverage

### 已完成

- 使用者選定V8作Vitest Coverage Provider。
- 新增D-043，並同步AGENTS、技術與實作計畫。
- 固定使用AST remapping、不混用Istanbul，Vitest／coverage-v8版本需一致。

### 尚未完成

- 尚未Scaffold，Vitest／coverage-v8 versions、reports與跨Windows／CI一致性尚未驗證。

### 驗證

- 本次只記錄Coverage Provider，未安裝套件、未產生報告，也未執行Git。

---

## 2026-09-02 — Code Coverage分級門檻

### 已完成

- 使用者選定依模組分級Coverage。
- 新增D-042，並同步AGENTS、技術與實作計畫。
- 核心Domain branches設100%，Application 90%，Adapters／UI較低，並保留全域最低門檻；autoUpdate關閉。

### 尚未完成

- 尚未Scaffold，coverage provider、glob config、exclude清單與CI report尚未建立。

### 驗證

- 本次只記錄Coverage策略，未執行測試或coverage，也未執行Git。

---

## 2026-09-02 — 前端與Accessibility完整測試方案

### 已完成

- 使用者選定Vitest＋jsdom＋React Testing Library＋user-event＋jest-dom＋axe元件測試，以及Playwright＋axe瀏覽器測試。
- 新增D-041，並同步AGENTS、UI、技術與實作計畫。
- 明定axe／jsdom不能取代真實Browser與人工Keyboard／Screen Reader驗收。

### 尚未完成

- 尚未Scaffold，實際test packages、setup files、component／browser tests與人工checklist尚未建立。

### 驗證

- 本次只記錄測試策略，未安裝套件、未執行測試，也未執行Git。

---

## 2026-09-02 — OpenAI Development Project Rate Limit

### 已完成

- 使用者選定30 RPM、500K TPM、40 IPM及100 RPD的平衡方案。
- 依OpenAI Docs核對Project可設定requests／tokens／images per minute及requests per day，部分欄位依model可用性而定。
- 新增D-040，並同步AGENTS、OpenAI、Server與實作計畫。

### 尚未完成

- 尚未建立Development Project，實際Usage Tier、Terra欄位可用性與Rate Limit尚未配置／驗證。

### 驗證

- 本次只記錄Rate Limit決策，未呼叫OpenAI Admin API、未產生費用，也未執行Git。

---

## 2026-09-02 — OpenAI Development Project月額：US$100

### 已完成

- 使用者選定Development Project每月US$100 Hard Spend Limit。
- 設計US$50／US$80 Spend Alerts，並要求Runtime只持有scoped service key、不得持有Admin Key。
- 新增D-039，並同步AGENTS、OpenAI、Server與實作計畫。

### 尚未完成

- 尚未建立／配置OpenAI Development Project，Hard Limit與Alerts仍是部署Gate，尚未實際驗證。

### 驗證

- 本次只記錄Project預算決策，未呼叫OpenAI Admin API、未產生費用，也未執行Git。

---

## 2026-09-02 — OpenAI Service Tier：Default

### 已完成

- 使用者選定每次Responses request明確使用`service_tier: default`。
- 依OpenAI Docs核對default為標準價格／效能，auto則依Project設定。
- 新增D-038，並同步env、AGENTS、OpenAI、系統、技術與實作計畫。

### 尚未完成

- 尚未Scaffold，request parameter、resolved-tier provenance與anomaly tests尚未實作。

### 驗證

- 本次只記錄Service Tier決策，未呼叫OpenAI API、未產生費用，也未執行Git。

---

## 2026-09-02 — OpenAI案件預算：寬鬆方案

### 已完成

- 使用者選定每案件16 provider attempts、concurrency 2、500K input、50K output＋reasoning及約US$2工程警戒。
- 依OpenAI Docs核對2026-09-02 Terra標準token價格與Project rate／spend controls。
- 新增D-037，並同步AGENTS、OpenAI、系統、Server、技術與實作計畫。

### 尚未完成

- 尚未Scaffold，budget reservation、usage reconciliation、Project hard-spend月額與超限tests尚未實作。

### 驗證

- 本次只記錄預算決策，未呼叫OpenAI API、未產生費用，也未執行Git。

---

## 2026-09-02 — 技術選型：TypeScript 6.0

### 已完成

- 使用者選定TypeScript 6.0穩定線。
- 新增D-036，並同步AGENTS、技術設計與實作計畫；已決定的UI元件庫也從尚待決定表移除。
- 固定Scaffold時鎖定最新`6.0.x`及相容typescript-eslint／Next／React／Node types，暫不採TypeScript 7。

### 尚未完成

- 尚未Scaffold，實際TypeScript patch與工具鏈相容版本尚未鎖定或執行typecheck。

### 驗證

- 本次只記錄版本決策，未安裝TypeScript、未建立tsconfig，也未執行Git。

---

## 2026-09-02 — 技術選型：TypeScript增強嚴格模式

### 已完成

- 使用者選定TypeScript增強嚴格模式。
- 新增D-035，並同步AGENTS、技術設計與實作計畫。
- 固定strict、unchecked index、exact optional、returns／switch／override／side-effect import checks與noEmit。

### 尚未完成

- 尚未Scaffold，tsconfig、實際TypeScript版本、typecheck scripts與第三方wrapper驗證尚未建立。

### 驗證

- 本次只記錄型別策略，未建立tsconfig、未執行typecheck，也未執行Git。

---

## 2026-09-02 — 技術選型：PDF平衡限制

### 已完成

- 使用者選定契約PDF單份15 MiB、最多30頁、抽取文字最多300,000字元。
- 新增D-034，並同步AGENTS、產品、技術、安全與實作計畫。
- 固定每request一份，stream／PDF.js document／text aggregation三層限制且不得由client覆寫。

### 尚未完成

- 尚未Scaffold，byte streaming、page／text limits、timeout與PDF對抗測試尚未實作。

### 驗證

- 本次只記錄限制決策，未解析PDF、未執行壓力測試，也未執行Git。

---

## 2026-09-02 — 技術選型：寬鬆圖片限制

### 已完成

- 使用者選定每張25 MiB、50 MP、每案件原始圖片400 MiB、Derivative最長邊3200 px。
- 新增D-033，並同步AGENTS、產品、技術、安全與實作計畫。
- 固定每個request一張圖，stream／Sharp／repository三層驗證且不得由client覆寫。

### 尚未完成

- 尚未Scaffold，security constants、body streaming、Sharp limits、case quota與load tests尚未實作。

### 驗證

- 本次只記錄限制決策，未處理圖片、未執行壓力測試，也未執行Git。

---

## 2026-09-02 — 技術選型：Sharp

### 已完成

- 使用者選定Sharp作P0 JPEG／PNG server-side圖片處理方案。
- 新增D-032，並同步AGENTS、技術設計與實作計畫。
- 固定Sharp負責auto-orient、受限resize／re-encode與metadata stripping；禁止保留EXIF／GPS或解除資源限制。

### 尚未完成

- 尚未Scaffold，Sharp版本、跨平台optional dependencies、圖片限制與對抗測試尚未建立。

### 驗證

- 本次只記錄技術決策，未安裝Sharp、未處理圖片，也未執行Git。

---

## 2026-09-02 — 技術選型：Mozilla PDF.js

### 已完成

- 使用者選定Mozilla PDF.js／`pdfjs-dist`作P0文字型PDF逐頁抽取方案。
- 新增D-031，並同步AGENTS、系統、技術設計與實作計畫。
- 固定PDF.js只存在server adapter，輸出page／excerpt／position locator；不執行active content或任意URL fetch。

### 尚未完成

- 尚未Scaffold，實際pdfjs-dist版本、Node worker／font設定、resource limits與parser tests尚未建立。

### 驗證

- 本次只記錄技術決策，未安裝PDF.js、未解析檔案，也未執行Git。

---

## 2026-09-02 — 技術選型：ESLint＋Prettier

### 已完成

- 使用者選定ESLint Flat Config作code-quality linter，Prettier作獨立formatter。
- 新增D-030，並同步AGENTS、技術設計與實作計畫。
- 固定CI顯式分開執行lint、format check與typecheck，不依賴Next build。

### 尚未完成

- 尚未Scaffold，實際ESLint／Prettier versions、flat config與scripts尚未建立。

### 驗證

- 本次只記錄技術決策，未安裝工具、未建立config，也未執行Git。

---

## 2026-09-02 — 技術選型：shadcn/ui＋Radix

### 已完成

- 使用者選定 shadcn/ui＋Radix Primitives 作為 UI 元件基礎。
- 新增 D-029，並同步 AGENTS、UI、技術設計與實作計畫。
- 固定只加入必要官方元件、generated source 進 repository、第三方 registry 預設拒絕，視覺仍由 RentProof tokens 控制。

### 尚未完成

- 尚未 Scaffold，實際 shadcn／Radix versions、components.json、元件清單與 accessibility tests 尚未建立。

### 驗證

- 本次只記錄技術決策，未執行 shadcn CLI、未安裝套件，也未執行 Git。

---

## 2026-09-02 — 技術選型：Next.js 16 Active LTS

### 已完成

- 使用者選定 Next.js 16 Active LTS＋App Router。
- 新增 D-028，並同步 README、AGENTS、技術設計與實作計畫。
- 規劃 Scaffold 時鎖定最新 patched `16.x`，Next／React 相容集合進 pnpm lockfile；暫不啟用實驗功能。

### 尚未完成

- 尚未 Scaffold，因此實際 Next／React patch 與 Turbopack build 相容性尚未驗證。

### 驗證

- 本次只記錄技術決策，未安裝套件、未建立 Application，也未執行 Git。

---

## 2026-09-02 — 技術選型：Node.js 24 LTS

### 已完成

- 使用者選定 Node.js 24 LTS 作為 Application runtime。
- 新增 D-027，並同步 README、AGENTS、技術設計與實作計畫。
- 規劃在 Scaffold 時鎖定當時最新 `24.x` patch，開發、CI 與 Production 使用一致版本。

### 尚未完成

- 尚未 Scaffold，因此實際 patch、`.node-version`、`engines` 與 CI runtime 尚未建立。

### 驗證

- 本次只記錄技術決策，未安裝 Node.js、未建立 Application，也未執行 Git。

---

## 2026-09-02 — 技術選型：pnpm

### 已完成

- 使用者選定 pnpm 作為唯一 JavaScript／TypeScript package manager。
- 新增 D-026，並同步 AGENTS、技術設計與實作計畫。
- 規劃在 Scaffold 時鎖定 `packageManager` 版本並提交 `pnpm-lock.yaml`；不混用其他 lockfile。

### 尚未完成

- 尚未 Scaffold，因此 pnpm 確切版本與安裝／lint／typecheck／test／E2E 指令尚未產生。

### 驗證

- 本次只記錄技術決策，未安裝 pnpm、未建立 `package.json`，也未執行 Git。

---

## 2026-09-02 — HTTP 區域網路開發 Server 配置

### 本次目標

允許開發階段不使用 HTTPS，讓私人區域網路中的手機／電腦連線，同時不降低 Production 與真實資料安全邊界。

### 已完成

- 新增 `docs/SERVER_CONFIGURATION.md`，集中定義 listener、profiles、env、LAN firewall、Host／Origin、synthetic allowlist、OpenAI Live cost controls 與 Production invariants。
- Deployment profiles 收斂為 `local_development`、`lan_development`、`public_showcase`、`production`；Fixture／Live 改由獨立 startup-only LLM mode 決定。
- `lan_development` 使用 HTTP、明確 RFC1918 IPv4、exact Host／Origin、Windows Private firewall／來源子網，拒絕 `0.0.0.0`、`::`、public IP、wildcard與 port forwarding。
- LAN profile 關閉 production 註冊、登入、Email／SMS reset、歷史、production guest／account sessions；7 天 sliding session 仍只適用 HTTPS Production。
- LAN ingest 只接受外部 Demo manifest 中 `synthetic: true` 且 SHA-256 相符的素材；未知素材不保存、不送 OpenAI。
- Fixture 為 LAN 預設；LAN Live 需顯式切換、server-only key、request／concurrency limit與 OpenAI Project spend control。
- 更新 `.env.example`、README、AGENTS、產品、系統、技術、UI、OpenAI、安全、帳戶、政策與實作文件；新增 D-025。

### 驗證

- Production 仍要求 HTTPS、Secure cookie、owner authorization、private storage與真實資料 Gate。
- HTTP LAN 被明確限制在 trusted private network＋synthetic data，不宣稱等同 HTTPS 安全。
- 本次只修改配置／規劃文件；尚未有 Next listener、Firewall rule、自動檢查或測試可執行。
- 本次沒有執行 Git 指令。

### 尚未完成

- 尚未 scaffold Next.js 啟動器，env 尚未實際接入 listener。
- 尚未建立 Windows Firewall 規則或在實體手機上做 LAN smoke test。
- 外部 Demo manifest／素材尚未完成，LAN synthetic hash allowlist 尚不能執行。

---

## 2026-09-02 — 選用帳戶、歷史紀錄與政策草案

### 本次目標

把登入、註冊、忘記密碼、歷史租約、隱私政策、使用條款與 Cookie 政策納入系統規劃，同時維持「不強制登入、單一網站入口」。

### 已完成

- 新增 `docs/AUTH_AND_HISTORY.md`，定義 guest／user `ActorContext`、owner-scoped access、歷史案件、guest-to-user case transfer 與 production storage。
- 依最新產品決策把「production 強制登入」改為單一入口：訪客可完成案件流程，登入／註冊只增加跨 session／裝置的歷史查詢。
- 訪客建立案件前與上傳區必須顯示：未登入案件不會出現在歷史紀錄，session／Cookie 遺失或換裝置後可能無法找回；資料仍是私有、不得公開列舉。
- 忘記密碼規劃為 managed identity provider 的 Email 或 SMS challenge；SMS 只對已綁定、已驗證電話開放，含 generic response、短效單次、attempt／resend limit、rate limit 與舊 session 撤銷。
- 帳戶 session 固定為 7 天 sliding idle expiry；合格主動使用會延長，static／prefetch／polling／failed request 不延長，guest session 另訂較短期限。
- 新增 `docs/PRIVACY_POLICY_DRAFT.md`、`docs/TERMS_OF_USE_DRAFT.md`、`docs/COOKIE_POLICY_DRAFT.md`，全部標示為未生效草案與真實資料 release blocker。
- 定義 `PolicyDocument`、append-only policy events 與 purpose-scoped `ConsentPreference`；Terms、Privacy Notice、OpenAI Cloud Processing 與非必要 Cookie 不合併。
- 第一個 production release 採必要 Cookie only，不啟用 analytics／marketing trackers。
- 更新 README、AGENTS、產品、UI、技術、安全、系統架構、實作計畫、決策與優化清單的相關邊界。

### 官方與安全基準核對

- 個人資料保護法：告知、當事人權利、特定目的、安全維護、刪除與國際傳輸；官方頁面目前標示部分 2025 修正條文尚未施行，正式上線前需重新核對。
- 消費者保護法與經濟部網路交易定型化契約規範僅作 Terms 設計 Gate；RentProof 的實際行業／交易適用性需由台灣法務確認。
- OWASP Authentication、Session Management、Authorization 與 Forgot Password：server-side session、每 request owner check、generic reset response、single-use challenge 與 session revocation。

### 尚未完成／風險

- 尚未選擇 identity、Email 或 SMS provider，也未設定 guest retention／purge SLA、account absolute reauthentication window 或 SMS 成本上限。
- 三份政策仍含營運者、聯絡方式、保存期限、處理地區、未成年人與爭議處理 placeholders；不得發布為正式法律文件。
- 尚未 scaffold 或實作任何 guest、auth、database、policy、Cookie 或刪除程式，也未執行相關測試。

### 驗證

- 文件明確區分 P0 synthetic Demo 與 first real-data release；P0 scope 沒有被帳戶功能擴張。
- 技術失敗仍使用獨立 reason code，不轉成 domain 的證據不足或「沒有問題」。
- 本次沒有執行 Git 指令。

---

## 2026-09-02 — 系統架構基線

### 本次目標

把分散在產品、技術、OpenAI、安全與防詐文件的約束，收斂成可直接實作的 P0 系統架構。

### 已完成

- 新增 `docs/SYSTEM_ARCHITECTURE.md`，作為系統邊界、模組、依賴、DAG、儲存、API、部署與失敗模式的架構來源。
- 新增 `docs/UI_DESIGN.md`，固定 mobile-first RWD、極簡視覺、清晰字級、寬鬆排版、accessibility 與 print 規格。
- 固定 P0 為 loopback-only Next.js Node 模組化單體，不使用 Edge、serverless、ORM、queue 或微服務。
- 定義 presentation → application → domain／ports ← infrastructure 的依賴方向與建議目錄。
- 定義 `CaseStateRepository`、`ArtifactStore`、`ModelGateway`、`PdfTextExtractor`、`RuleRegistry` ports 與 P0 adapters。
- 定義 CaseState aggregate、runtime／Demo／rule snapshot layout、JSON atomic write、revision 與 per-case mutex。
- 定義 analysis stage DAG、stage state machine、stage-run key、cache、dependency invalidation 與補件局部重跑。
- 定義主要分析／補件 sequence、P0 APIs、error envelope、OpenAI gateway、official-rule engine、FRS-001 與 report composer。
- 定義 P0 trust boundaries、observability、failure modes，以及 P1 PostgreSQL／object storage／queue-worker 演進。
- 新增 D-019／D-020，並同步 README、AGENTS、PRODUCT_SPEC、TECHNICAL_DESIGN 與 IMPLEMENTATION_PLAN。

### OpenAI Docs 核對

- Responses API 可接受 text、image、file inputs 並回傳 JSON Structured Outputs。
- `store` 控制 response application state retrieval，但不等同 Zero Data Retention；架構仍以 server-only、foreground、stateless、`store: false` 為基線。

### 尚未完成

- 尚未 scaffold `src/` 目錄、ports、adapters 或任何可執行程式。
- 尚未建立 Zod domain schemas、stage orchestrator、JSON repository 或 OpenAI gateway。
- 尚未執行架構驗收測試。

### 驗證

- 架構沒有把 Claim、OfficialRule 與 FraudSignal 結果語意混合。
- Live／fixture mode、truth／fallback、Demo／runtime／repository 邊界皆明確分離。
- P0 local-only 與 P1 public deployment 的安全 Gate 已分開。
- 四個 tab 的 Desktop／Mobile 等價呈現、snapshot 一致性、16 px 以上正文、14 px 以上 caption、200% zoom 與 A4 print 已列為 Gate。
- 本次沒有執行 Git 指令。

---

## 2026-09-02 — 租屋詐騙風險訊號規劃

### 本次目標

在不宣稱「確定詐騙」的前提下，把官方防詐指引轉成可定位、可查證的付款前風險訊號。

### 已完成

- 新增 `docs/FRAUD_RISK_SIGNALS.md`，定義輸入、結果、action、訊號 catalog、OpenAI／程式分工、UI、Demo 與安全 Gate。
- 單人 P0 收斂為 `FRS-001`：首次實地看屋前要求付款；`FRS-002` 至 `FRS-010` 列 P1。
- 新增 synthetic interaction／payment timeline 規格；外部 `RentProof-Demo/interaction/` 已建立。
- 更新產品、技術、OpenAI、實作、Demo、Security、官方規則、決策、AGENTS 與優化清單。
- 修正禁止措辭：允許功能名稱「詐騙風險訊號」與官方來源標題，但禁止「確定詐騙」「就是詐騙」「詐騙機率」「安全無虞」。

### 官方來源核對

- 高雄市政府警察局：假房東、看屋前付款、寄送鑰匙與假客服連結。
- 經濟部標準檢驗局：親自看房、核對身分／地籍、避免先匯訂金。
- 中華郵政防詐專區與 165 全民防騙網：假冒租屋預付訂金與查證建議。

### 尚未完成

- 尚未製作 synthetic interaction／timeline、truth assertion 或 fallback snapshot。
- 尚未實作 Interaction extractor、`FRS-001` evaluator、UI risk card 或測試。
- 防詐 guidance sources 尚未建立獨立版本化 snapshots／SHA-256。

### 驗證

- `FRS-001` 必須同時有付款要求 locator，以及付款要求早於首次實地看屋的完整 synthetic 時間線；任一未知即資料不足。
- 防詐訊號不進 Claim 三態或 OfficialRule engine，也不合成整體分數。
- 本次沒有執行 Git 指令。

---

## 2026-09-01 — 官方來源快照與 SHA-256

### 本次目標

凍結規則庫使用的 6 個行政院／內政部官方來源，建立可重現快照與完整性 hash。

### 已完成

- 在 `rules/snapshots/2026-09-01/` 保存 5 個 HTML 與 4 個 PDF。
- 建立 `manifest.json`，記錄 6 個 primary sources、3 個 supporting landing pages、官方 URL、相對路徑、content type、bytes、版本／生效日、驗證條件與 SHA-256。
- 將契約範本、電費修正與租金補貼修正的官方原文 PDF 設為 primary snapshots，HTML 頁保留為 supporting provenance。
- 將 6 個 `snapshot_path`／`snapshot_sha256` 回填 `rules/official-rules.v1.yaml`。
- 更新官方規則文件與優化清單；規則集仍維持 draft，直到 typed evaluators 與 regression 完成。

### 驗證

- 5 個 HTML 均包含預期官方標題／關鍵字，且不含 `Request Rejected`。
- 4 個 PDF magic 均為 `%PDF-`；`pdfinfo` 顯示頁數分別為 13／23／5／1，全部無 JavaScript、未加密。
- bundled `pypdf` 成功抽取三個新增 primary PDFs，預期契約／電費／租金補貼關鍵文字均存在。
- 下載檔案重新計算的 SHA-256 與 manifest／YAML 一致。
- 本次沒有執行 Git 指令。

---

## 2026-09-01 — OpenAI Cloud、模型與安全基線

### 本次目標

正式決定 OpenAI Cloud LLM 與性價比模型，並把安全、資料契約與剩餘產品優化納入 P0。

### 已完成

- OpenAI Cloud provider 固定使用 Responses API 與官方 TypeScript SDK。
- 依 OpenAI Docs 選定 `gpt-5.6-terra`＋reasoning `medium` 作為智慧／成本平衡的 P0 預設。
- 新增 `docs/OPENAI_INTEGRATION.md`：Structured Outputs、Gateway、server-only key、錯誤、usage、`store: false` 與資料保留 caveat。
- 新增 `docs/SECURITY_PRIVACY.md`：trust boundaries、upload／path、prompt injection、API key、資料外送、模型失敗與真實資料 Gate。
- 外部 Demo 資料由 `expected/` 拆成 `truth/` 與 `fallback/`，避免人工真值與模型快照 circular test。
- 廣告矩陣固定 4 個 claims；牆面不明變色改為獨立 `observation_follow_up`。
- Locator／Finding 改為 discriminated unions，金額改用 minor units／decimal string，抽取狀態區分 known／not_present／unknown。
- 規則 YAML 新增 P0 active profile、`evaluator_id`、implementation status 與 reason codes；自由文字判斷僅作文件，不可執行。
- 補強四畫面問題定義、action card、side-by-side locator 與補拍進展。

### OpenAI Docs 核對

- Responses API 支援文字、圖片／檔案輸入與 JSON Schema Structured Outputs。
- `gpt-5.6-terra` 官方定位為智慧與成本的平衡，支援影像輸入與 Structured Outputs。
- `store: false` 不等於 Zero Data Retention；abuse monitoring、圖片／檔案掃描與 prompt caching 仍依實際 OpenAI Project／官方政策處理。

### 驗證

- `.env.example` 只含空 key 與 `gpt-5.6-terra`／medium 的非秘密設定。
- Live／fixture mode 必須明確切換，provider failure 不會偷偷載入 fallback。
- 安全 Gate 明定 synthetic-only；未完成真實資料 Gate 前不得上傳真實租約／影像。
- 本次沒有執行 Git 指令。

### 尚未完成

- 尚未 scaffold application、安裝 OpenAI SDK 或執行 live API request。
- 官方規則來源 snapshots 當時尚未凍結；後續紀錄已完成快照與 SHA-256。規則集因 evaluator／tests 未完成仍維持 draft。
- 外部 Demo 素材、truth assertions 與 fallback snapshot 尚未實際製作。

---

## 2026-09-01 — 移除開發時間設定

### 本次目標

保留單人開發、P0／P1 範圍與工作相依關係，但不設定工時、逐時排程或開發截止點。

### 已完成

- 將實作計畫改為依 Gate 循序執行，不再列開發時數與逐時區段。
- Backlog 移除估時欄位，只保留優先級、相依工作與驗收條件。
- 移除 README、產品規格、技術設計、Demo 測試、官方規則與決策中的開發時間限制。
- 保留官方規則生效日、來源查核日及 Demo 操作腳本秒數；這些是版本／展示資訊，不是開發排程。

### 驗證

- 開發順序仍由 Golden truth → 外部素材 → domain → 分析 → UI → 補拍 → 報告 → 驗證組成。
- P0 仍是一個 Golden case、12 張照片與 6 條啟用規則。
- 本次沒有執行 Git 指令。

---

## 2026-09-01 — Demo 資料外移與單人規劃

### 本次目標

把所有 Demo 資料獨立到 RentProof 專案外，並將原本多人並行的計畫改成可由一人循序執行。

### 已完成

- 將原 `fixtures/golden-case/README.md` 移到同層的 `RentProof-Demo/README.md`。
- 建立外部 `listing/`、`viewing/frames/`、`contract/`、`follow-up/` 與結果資料目錄；後續將結果資料拆成 `truth/`／`fallback/`。
- 移除 RentProof 內已空的 `fixtures/` 目錄；目前專案樹不含 Demo 素材。
- 統一以 `RENTPROOF_DEMO_DIR` 載入外部資料，補拍暫存另用 `RENTPROOF_RUNTIME_DIR`。
- 將 P0 收斂為一個 Golden case、12 張照片、清楚文字 PDF 與 6 條啟用規則。
- 將工作改為依相依關係與品質 Gate 循序完成，不使用多人並行假設。
- 將 SQLite／Drizzle、影片、掃描 OCR、多案件與其餘 4 條規則移到 P1。

### 驗證

- 外部資料夾最初解析到repository外的使用者文件路徑，後續已改採`%USERPROFILE%\RentProof-Demo`規則。
- 移動前確認來源只有一個 Demo README，目的地不存在且位於指定的 ChatGPT 目錄內。
- 移動後確認 RentProof 內 `fixtures/` 為空再移除；沒有刪除 Demo README。
- 本次沒有執行任何 Git 指令；先前的暫存區仍是舊快照，之後允許 Git 操作時必須重新整理。

### 尚未完成

- 外部資料夾目前只有規格與目錄結構，尚未製作廣告、租約、照片、truth assertions 或 fallback snapshot。
- 尚未 scaffold application 或安裝依賴。
- Git／GitHub 操作依使用者指示維持暫停。

### 下一步

1. 完成 `RP-DEV-001` 的四個廣告 claims、一個現場 observation、locator 與人工真值。
2. 在外部 `RentProof-Demo/` 製作所有 synthetic 素材。
3. Golden truth 與外部素材通過 Gate 後才 scaffold 程式。

---

## 2026-09-01 — Greenfield 規劃基線

### 本次目標

把使用者提出的 RentProof 構想整理成可以直接開工、可驗收、可追溯的 MVP 規劃，並準備新的公開 GitHub repository。

### 已完成

- 盤點 workspace：原本只有 `.git`，沒有程式碼、技術棧、README、規格、測試或 remote。
- 建立產品規格：使用流程、四畫面、三態語意、成本呈現、安全邊界與 golden demo 結果。
- 建立技術設計：模組化單體、固定 Agent stages、evidence graph、source locator、API、模型／規則分工與隱私策略。
- 建立 milestone、issue-ready backlog、cut line、風險與 Definition of Done。
- 建立 golden case 素材、90 秒腳本、測試與對抗案例規格。
- 以官方來源人工核對 10 條規則，建立 `rules/official-rules.v1.yaml` 草案。
- 核對 2026 年上半年租金統計的發布日、樣本截止日與使用限制。
- 記錄公開 repository 與暫不選擇開源授權的決策。

### 外部來源核對

- 行政院現行住宅租賃定型化契約頁：最新修正日期 2025-04-18。
- 內政部租屋電費新制：2024-07-15 生效；按度／非按度計費與資訊透明規定已納入。
- 內政部租金補貼不得記載事項：2023-06-14 生效。
- 內政部 115 年上半年租金統計：2026-08-13 發布，樣本為截至 2026-03-31 的 83.3 萬件租金補貼有效租約。
- OpenAI 官方 API 文件：Responses API 支援文字、圖片／檔案輸入與 Structured Outputs；技術設計未硬編碼 model ID。

### 驗證

- 規劃文件中的 washing machine demo 一致採「未拍到＋附件未列＝證據不足」。
- 電費每度金額缺少同一標的同一期帳單時，規則一致輸出資料不足。
- 所有自動規則輸出採中立三結果，不以合法／違法命名。
- Demo 素材規格明定 synthetic only，未加入任何真實租屋資料。

### 尚未完成

- 尚未 scaffold application 或安裝依賴。
- 尚未製作模擬廣告、租約與影像檔。
- 尚未實作 domain schema、pipeline、UI 或測試。
- 公開 GitHub repository 將在文件一致性與 secrets 檢查後建立。

### 下一步

1. 完成文件 link／YAML／禁止措辭與 git diff 檢查。
2. 建立 initial planning commit 並推送新的 public `RentProof` repository。
3. 進入 `RP-DEV-001`：先寫 golden manifest 與人工真值。

---

## 紀錄模板

```md
## YYYY-MM-DD — 工作主題

### 本次目標

-

### 已完成

-

### 驗證

- 指令／測試：
- 結果：

### 決策與偏差

- 對應 D-XXX；或說明相對計畫的變更。

### 尚未完成／風險

-

### 下一步

1.
```
