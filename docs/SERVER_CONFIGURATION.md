# RentProof Server 配置

- 狀態：development／production configuration baseline
- 版本：0.1
- 日期：2026-09-02
- 目前實作狀態：P0 launcher／local與LAN profiles／Host／Origin／Firewall Gates已實作並完成Synthetic Demo smoke；本文件仍是啟動器與部署設定的canonical contract

## 1. 配置原則

1. 開發階段與公開Synthetic Showcase允許HTTP；Production必須HTTPS。
2. 預設只允許本機 loopback。區域網路測試必須明確切換 `lan_development`，不能因 Next.js 預設值意外 listen 所有介面。
3. Deployment profile 與 LLM mode 分離；profile 決定網路、資料、auth、cookie 與 storage 能力，LLM mode 只決定 Fixture／Live。
4. `lan_development` 只處理 synthetic data，不啟用 production identity、Email／SMS recovery、歷史或 7 天 account session。
5. Profile 在 process startup 固定，request、query、cookie 或 UI 不能切換。
6. Production 的 HTTPS、Secure cookie、private storage 與 owner authorization 不得被開發設定覆寫。

## 2. Deployment profiles

| Profile                | Listener／transport              | Data                     | Upload                    | Auth／history                        | OpenAI                            |
| ---------------------- | -------------------------------- | ------------------------ | ------------------------- | ------------------------------------ | --------------------------------- |
| `local_development`    | HTTP loopback                    | synthetic only           | Demo／受控補件            | Synthetic預設；self-hosted需顯式啟用 | Fixture 預設；Live 可顯式啟用     |
| `lan_development`      | HTTP、單一明確 RFC1918 IPv4      | synthetic allowlist only | 只接受 Demo manifest hash | 關閉                                 | Fixture 預設；Live 需額外成本控制 |
| `public_http_showcase` | 規格保留、目前disabled／不得部署 | synthetic fixture only   | 關閉                      | 關閉；無Cookie／session              | 關閉、無key／API                  |
| `production`           | Public HTTPS／受信任 TLS proxy   | real user data           | private quarantine        | guest＋optional account              | Worker-only Live                  |

`local_development`／`lan_development`／`public_http_showcase`若設定`RENTPROOF_ALLOW_REAL_DATA=true`必須拒絕Build／啟動。`production`若使用Fixture、HTTP canonical origin、local JSON history或未完成auth／policy／storage Gate，也必須拒絕啟動。

P0的`local_development`／`lan_development`在目前Windows桌面電腦執行；需驗證Windows Private network profile、Firewall來源限制、NTFS path／ACL與Node.js 24。Production OS暫不決定，不在本階段建立Windows Server或Linux專用服務設定。

P0由原生Node.js＋pnpm直接啟動Next.js，不經WAMP／Apache、IIS、Docker Desktop或Windows Service。啟動器需顯式把驗證後的bind host／port傳入Next listener；Node process不以Administrator執行。

## 3. `public_http_showcase` contract

- 由verified Golden fallback在Build time產生Next.js static export或等價靜態檔案；部署後沒有Node runtime、Route Handlers、Server Actions、WebSocket或資料寫入。
- 只包含Synthetic summary／matrix／contract review／report view models；不包含原始可辨識圖片、私人runtime paths或可由訪客提交的內容。
- 不部署`OPENAI_API_KEY`、identity／Email／SMS／database／object-storage credentials，build及bundle secrets scan必須為零。
- 不提供Upload、分析、follow-up、login、register、history、delete、Cookie preferences mutation或任何form；互動限於client-side tab／disclosure／print。
- 不設定RentProof Cookie、localStorage、sessionStorage、IndexedDB或service worker；不產生可誤認為保存進度的狀態。
- 不發布source maps、debug overlay、runtime env或internal stack。
- CSP限制`default-src 'self'`、`connect-src 'none'`，不載入第三方script／iframe／analytics；hashed static assets可immutable cache，HTML／fixture version需revalidate或no-cache。
- 所有頁面顯示不可關閉Banner：「公開HTTP Demo・內容可能被傳輸途中竄改・僅限虛構資料・不可作正式證據」。
- 加入`robots` noindex／nofollow與明確Demo metadata，避免搜尋結果被誤認正式服務。
- HTTP無法提供伺服器身分與內容完整性；任何網路中介都可能讀取或修改內容。Report hash同樣可能被修改，因此只作內部版本資訊，不作傳輸驗證。

`public_http_showcase`不是Production替代品；若未來加入任何真實資料、帳戶、API、Cookie、表單、付款或正式證據用途，必須先切換HTTPS並通過Production Gate。

目前D-046暫停Public HTTP部署：P0只使用local／private LAN，不建立VPS、Public DNS、Router Port Forwarding或Public Firewall Rule。`public_http_showcase`contract僅作未來設計，Build／deployment pipeline不得在D-046有效期間啟用。

## 4. Environment contract

```env
RENTPROOF_DEPLOYMENT_PROFILE=local_development
RENTPROOF_BIND_HOST=127.0.0.1
RENTPROOF_PORT=3000
RENTPROOF_PUBLIC_ORIGIN=http://127.0.0.1:3000
RENTPROOF_ALLOWED_HOSTS=localhost:3000,127.0.0.1:3000
RENTPROOF_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
RENTPROOF_ALLOW_REAL_DATA=false
RENTPROOF_AUTH_MODE=synthetic
# 只有精確loopback self_hosted Demo需要；32 random bytes的base64url，實值不放repository
RENTPROOF_AUTH_TOKEN_KEY=

RENTPROOF_LLM_MODE=fixture
OPENAI_API_KEY=
OPENAI_CONVERSATION_MODEL=gpt-5.6-luna
OPENAI_CONVERSATION_REASONING_EFFORT=low
OPENAI_EVIDENCE_MODEL=gpt-5.6-terra
OPENAI_EVIDENCE_REASONING_EFFORT=medium

RENTPROOF_DEMO_DIR=
RENTPROOF_DEMO_CASE_VERSION=golden-v1
# 留空時由Server解析為目前使用者的 %LOCALAPPDATA%\RentProof\runtime
RENTPROOF_RUNTIME_DIR=
```

Windows Development的`OPENAI_API_KEY`在Scaffold後只放repo-root `.env.local`；範例與repository檔案只保留空值。若Fixture mode仍觸發OpenAI、key進client／build／log，或`.env.local`未被ignore／ACL過寬，啟動／安全Gate失敗。

Synthetic mode不組裝帳戶runtime；`/auth`、`/history`與相關API由Server profile Gate回404。只有精確loopback `local_development`、`RENTPROOF_AUTH_MODE=self_hosted`、local-only PostgreSQL app role與有效`RENTPROOF_AUTH_TOKEN_KEY`同時成立時才啟用。Token key必須是32 random bytes的base64url並只存在受ACL保護的外部Demo環境檔；LAN profile只要發現self-hosted mode、key或帳戶DB設定即fail closed。Loopback可使用綁pre-auth browser context的記憶體synthetic mailbox；Production Email delivery另行決策。

`RENTPROOF_DEMO_DIR`留空時，Windows P0 resolver使用`%USERPROFILE%\RentProof-Demo`。目錄必須預先存在且通過fixed-local／overlap／reparse／sync checks；缺失回`DEMO_DIR_MISSING`，Server不得自動建立或複製素材。

`RENTPROOF_DEMO_CASE_VERSION`是local／LAN必填的單一version segment，只接受`^golden-v[1-9][0-9]*$`；不得為`latest`或任何path。無效時在讀取case檔案前fail closed。

LAN 開發範例只說明格式，不能直接複製 IP：

```env
RENTPROOF_DEPLOYMENT_PROFILE=lan_development
RENTPROOF_BIND_HOST=192.168.x.x
RENTPROOF_PORT=3000
RENTPROOF_PUBLIC_ORIGIN=http://192.168.x.x:3000
RENTPROOF_ALLOWED_HOSTS=192.168.x.x:3000
RENTPROOF_ALLOWED_ORIGINS=http://192.168.x.x:3000
RENTPROOF_ALLOW_REAL_DATA=false
RENTPROOF_LLM_MODE=fixture
```

實際 Scaffold 後，啟動器必須把 `RENTPROOF_BIND_HOST`／`RENTPROOF_PORT` 真正傳給 Next listener；只檢查 env、但 listener 仍綁 `0.0.0.0`，視為 Gate 失敗。

`authEnabled`、`secureCookies`、`readOnly`、`uploadsEnabled`、`requireHttps` 與 storage adapter 由 deployment profile 的 discriminated union 衍生，不另提供可以任意翻轉的 boolean。

## 5. `lan_development` startup validation

啟動前全部通過：

- `NODE_ENV`只允許`development`或`production`：日常LAN測試可使用Next Dev Server；正式Demo使用Production Build。`NODE_ENV=production`不會啟用RentProof Production能力。
- Bind 是本機 active network interface 上的一個 RFC1918 IPv4：`10.0.0.0/8`、`172.16.0.0/12` 或 `192.168.0.0/16`。
- 拒絕 `0.0.0.0`、`::`、public IP、APIPA、loopback、未配置 IP、wildcard host 與 IPv6 listener。
- `RENTPROOF_PUBLIC_ORIGIN` 是與 bind／port 一致的單一 `http://` origin。
- Allowed hosts／origins 不為空、不含 `*`／`null`，且全部與 bind／port 一致。
- `RENTPROOF_ALLOW_REAL_DATA=false`。
- Production identity、Email、SMS、history、account／production guest session adapters 沒有被組裝。
- Demo／runtime roots 通過 realpath、overlap、symlink／junction 與 public-directory checks。
- Direct LAN mode不配置reverse proxy；全域Next Proxy在auth與route之前驗證每個request的exact Host。`Forwarded`、forwarded chain、`X-Forwarded-Host`／Proto／Port mismatch及其他host override一律拒絕。Next 16 direct server會在Proxy前補齊缺少的`X-Forwarded-*`，因此matching synthetic headers只用來核對後即全部從upstream request移除；Application、auth與rate limit不得信任forwarded來源資訊。

任一條件失敗即停止啟動，不自動退回較寬鬆的 listener。

## 6. LAN network boundary

- Windows network profile 必須是 `Private`。
- Firewall inbound rule依D-065允許目前Windows `Private` network中所有可達來源，但只限RentProof指定TCP port與指定本機LAN IP；不得套用到Public／Domain profile或其他port／program。
- 該Rule保留但預設disabled；Demo前由獨立elevated管理腳本enable，結束後disable。腳本只管理／驗證Firewall，不啟動Node；App process保持standard user。`lan_development`啟動前需驗證rule scope與enabled狀態，結束checklist需確認rule回到disabled。
- Windows `Public` profile 不允許該 inbound rule。
- Router 禁止 port forwarding、DMZ、UPnP exposure；不使用 ngrok、Cloudflare Tunnel、公開 reverse proxy 或未審查 VPN overlay。
- Server 不回 `Access-Control-Allow-Origin: *`，也不開啟全域 CORS。
- `Host` 在所有 request 驗證；mutation 另外要求 exact `Origin`、CSRF token，並可檢查 `Sec-Fetch-Site: same-origin`。
- Global Host Gate涵蓋頁面、API、`_next`靜態資產與favicon；安全GET不要求`Origin`，但任何missing／multiple／malformed／非allowlist Host均在auth前回不含設定值的4xx。
- Missing／`null`／不符 allowlist 的 mutation Origin 一律拒絕。

LAN HTTP不能防止同網段的被動旁聽或主動竄改；D-065也允許Private網路中的非展示裝置連線，因此「trusted private LAN＋synthetic-only」是必要前提，不宣稱等同HTTPS安全性。偵測到Public／Domain profile、非RFC1918介面或Production credentials時必須fail closed。

## 7. Synthetic-only enforcement

LAN banner 只是告知，不足以技術防止誤傳。`lan_development` 的 ingest 必須：

1. 只接受 `RENTPROOF_DEMO_DIR` manifest 已列出的 artifact。
2. Manifest item 必須有 `synthetic: true`、kind、bytes、MIME 與 SHA-256。
3. Upload 解碼、re-encode／sanitize 後，仍須能連回 allowlisted source／derivative lineage。
4. 不在 manifest 或 hash 不符，回 `DEV_SYNTHETIC_ARTIFACT_NOT_ALLOWLISTED`，不寫入 available store、不送 OpenAI。
5. 依D-076，Conversation composer可接受arbitrary free text；這是synthetic-only的窄例外。Server不得把文字直接當evidence／domain state，需做size／rate／PII best-effort／prompt-injection Gate與typed confirmation。Manifest外artifact仍拒絕。
6. 一般PII pattern回warning並可由同actor、payload-bound acknowledgement繼續；auth secrets、完整金融帳號、QR／data URL為不可繞過hard block。Acknowledgement不能改善HTTP傳輸保密性，UI需在首次送出前先做client warning。
7. Demo directory唯讀；runtime預設`%LOCALAPPDATA%\RentProof\runtime`，不得位於repository、Demo、`public/`、Documents／OneDrive、Windows shared folder、UNC／removable drive或reparse point。

Runtime cleanup依D-068：Development run最後寫入後最多保留7天；Formal Demo使用獨立run child並於正常結束清除，abandoned formal run在下次Demo前清除。Cleanup前必須取得lock並重新驗證root containment、volume、reparse與ownership marker；不得刪除root、repository或Demo。

若要用手機測試補拍，先把完全虛構的補拍素材加入外部 Demo manifest，再由手機選取同一檔案。未來若要直接拍攝任意新照片，需另開 threat／privacy review；不能只靠「我確認是虛構資料」checkbox 宣稱已強制 synthetic-only。

## 8. LAN Live mode

`lan_development` 預設 `RENTPROOF_LLM_MODE=fixture`。若顯式切換 `live`：

- Browser → RentProof 仍是 HTTP；RentProof server → OpenAI 必須 HTTPS。
- `OPENAI_API_KEY` 只由 server adapter 讀取，不進 HTML、source map、client bundle、error overlay、JSON、log 或 debug route。
- 固定 model／reasoning allowlist，不接受 request 指定 key、model、base URL 或 endpoint。
- 啟用來源 IP、case、request、concurrency 與 submitted-bytes limits。
- P0／LAN Live沿用每案件16 provider attempts、concurrency 2、500K input、50K output＋reasoning及US$2工程警戒；LAN另加來源IP rate limit。
- OpenAI Project 使用獨立 development key、rate／spend control。
- Development Project設定US$100／month hard spend limit及US$50／US$80 alerts；Runtime不持有OpenAI Admin Key。Production使用另一個Project／key／limit。
- Development Project rate limit設定30 RPM、500K TPM、40 IPM（若欄位可用）、100 RPD；LAN另有來源IP／case limit，Application concurrency仍為2。
- Stage idempotency／cache 防止重複付費；provider failure 維持 stage failure，不偷偷載入 Fixture。
- 所有artifact payload仍必須通過synthetic manifest allowlist；Conversation text依D-076走獨立free-text Gate。

## 9. HTTP headers、HMR 與 dev context

LAN HTTP 不設定：

- HSTS。
- `upgrade-insecure-requests`。
- Production `Secure`／`__Host-` account session cookie。

仍必須設定：

- CSP；若使用 HMR，只額外 allow exact `ws://private-ip:port`，不可 wildcard。
- `frame-ancestors 'none'` 或等價 frame protection。
- `X-Content-Type-Options: nosniff`。
- Strict Referrer Policy。
- Case、artifact、report response 使用 `Cache-Control: private, no-store`。

LAN profile 不啟用正式 login／registration／password reset。若需要暫時綁定同一開發裝置，使用名稱完全不同的 dev-only session context：process restart 失效、不滑動 7 天、只綁 synthetic case、`HttpOnly`、`SameSite=Strict`、host-only、token 不進 URL／log。因 HTTP 必須 `Secure=false`，不得承載帳戶或敏感權限，也不得轉移成 production owner。

多裝置展示優先使用 development-configured production build；不要把包含 source map、詳細錯誤與 HMR 的 dev server 開給不受信任網段。若未來需要 `getUserMedia` 等 secure-context API，仍需導入 development HTTPS；本次 HTTP 決策不保證所有瀏覽器相機 API 可用。

正式Demo固定使用Production Build＋`lan_development`，預設Fixture且維持synthetic manifest allowlist。Build／runtime不得載入Production identity、database、object storage或backup credentials；browser／server source maps與詳細error overlay不得發布，HMR／WebSocket不啟用。日常Dev Server的HMR只允許exact LAN origin／port與受信任測試裝置。

## 10. Production invariants

- Canonical origin 必須是 HTTPS。
- 若由 proxy 終止 TLS，只信任明確 proxy IP／network，不信任任意 `X-Forwarded-*`。
- Account cookie由RentProof管理：32-byte opaque token、DB只存keyed digest、7天sliding idle expiry；只有合格主動使用原子延長並刷新Cookie。Guest cookie另依固定24小時policy。
- Production App與PostgreSQL同一Server，但PostgreSQL只listen loopback／local socket；Firewall拒絕LAN／Internet DB port。App／migration／backup使用分離least-privilege roles，DB data directory只允許PostgreSQL service account。
- 同機磁碟不算災難備份；加密backup／PITR必須送往off-host private storage且最多保存14天。Host故障同時中斷App／DB，初期不宣稱HA。
- Self-hosted Auth、Email delivery、PostgreSQL、private object storage、queue／workers、retention／deletion、policies與audit Gate全部完成；SMS／phone功能維持disabled。
- Production 不載入 external Demo fallback、不允許 Fixture mode，也不讀 LAN listener config。
- Production的Public HTTP request只可由受信任edge redirect HTTPS；Production canonical origin與所有敏感處理仍為HTTPS。這不適用獨立的`public_http_showcase`。

### PostgreSQL adapter scaffold與Synthetic Demo Gate

- Kysely＋node-postgres adapter與migration command可在`local_development`／`lan_development`預先驗證，但此時`RENTPROOF_DATABASE_ENVIRONMENT`必須為`synthetic_demo`或`local_test`、`RENTPROOF_ALLOW_REAL_DATA=false`，且database name必須包含`demo`。
- 不論HTTP App綁定localhost或LAN private IP，PostgreSQL endpoint只接受`localhost`／`127.0.0.1`／`::1`；不得把5432或其他DB port開給LAN。Browser不接觸connection string或DB credentials。
- Web process不會在startup或request自動執行migration。Operator須顯式將`RENTPROOF_DATABASE_ROLE=migration`後執行`pnpm db:migrate -- up`；`down`只准`local_test`，Synthetic Demo及Production皆拒絕。
- Windows Synthetic Demo先以`pnpm db:listener:check -- <port>`驗證指定port只有`127.0.0.1`／`::1` listener，再依`docs/POSTGRES_DEMO_RUNBOOK.md`建立NOLOGIN owner、獨立migration／app LOGIN roles並執行readiness。Listener暴露、role權限過大、不安全`search_path`、schema不完整或App可操作Kysely migration metadata時均fail closed。
- 這個scaffold不會啟用真實資料、Production auth、history或object storage；HTTP Demo資料仍限完全虛構。Production database config仍要求Production profile、`RENTPROOF_ALLOW_REAL_DATA=true`及HTTPS canonical origin。

## 11. 驗收

### Local／LAN

- Local profile 從其他裝置無法連線。
- LAN 指定測試裝置能開啟 `http://private-ip:port`；listener 不是 `0.0.0.0`／`::`。
- 其他來源、Public network profile、IPv6、偽造 Host、DNS-rebinding Host、missing／null／跨站 Origin 均被拒絕。
- 無 wildcard CORS；跨站 form／fetch 不能 mutation。
- LAN 持續顯示 HTTP／private LAN／synthetic-only banner。
- Account／reset／history routes 關閉；dev context 與 production cookie 不混用。
- 未 allowlist artifact 被拒；manifest synthetic artifact 可完成 Golden flow。
- Fixture mode network request count 為 0；Live key 不進 bundle且有成本限制。

### Public／Production regression

- `public_http_showcase`是HTTP static export、synthetic-only、無server／API／upload／key／Cookie／form／service worker／source map，並有persistent integrity warning與noindex。
- Production 對 HTTP canonical origin、Fixture、insecure cookie、未受信任 proxy、local JSON storage 或未完成 Security Gate皆拒絕啟動。
- HTTPS、self-hosted Secure／HttpOnly cookie、7天sliding Session、owner authorization、private storage與deletion tests維持通過。

本文件定義配置契約；實際安裝、啟動、lint、typecheck、test 與 E2E 指令要等技術棧 scaffold 後再寫入 `AGENTS.md`，不得提前虛構。
