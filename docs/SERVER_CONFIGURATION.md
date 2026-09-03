# RentProof Server 配置

- 狀態：目前開發與區域網路展示的設定契約
- 更新日期：2026-09-03

## 1. 現行 Profiles

| Profile                | 對外連線                    | 用途                     | 資料／帳戶                                    |
| ---------------------- | --------------------------- | ------------------------ | --------------------------------------------- |
| `local_development`    | `http://127.0.0.1:3000`     | 日常開發與本機測試       | 預設測試資料；自建帳戶需明確啟用              |
| `lan_secure_demo`      | `https://<明確私人IP>:3443` | 同一私人網路的跨裝置展示 | 私有資料、訪客或自建帳戶，需通過全部安全 Gate |
| `public_http_showcase` | 停用                        | 未來可能的靜態唯讀展示   | 不得 Build 或部署                             |
| `production`           | HTTPS                       | 未來正式服務             | 尚未完成 Production Gate                      |

舊的 `lan_development` HTTP profile 已依 D-093 退役。`dev:lan`、`start:lan`、`.env.lan.local`與 `--profile=lan` 均不是可用介面；啟動器遇到舊值必須拒絕，而不能自動改用較寬鬆設定。

Profile 只在 process 啟動時決定，不能由 request、query、Cookie 或瀏覽器切換。`NODE_ENV=production`只代表 Next.js Build／Runtime 最佳化，不會自動開啟正式資料能力。

## 2. 本機 HTTP

`local_development` 固定只綁定 `127.0.0.1`。它拒絕私人網路IP、公開IP、`0.0.0.0`、`::`、wildcard Host／Origin以及任何 Forwarded override。

```env
RENTPROOF_DEPLOYMENT_PROFILE=local_development
RENTPROOF_BIND_HOST=127.0.0.1
RENTPROOF_PORT=3000
RENTPROOF_PUBLIC_ORIGIN=http://127.0.0.1:3000
RENTPROOF_ALLOWED_HOSTS=localhost:3000,127.0.0.1:3000
RENTPROOF_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
RENTPROOF_ALLOW_REAL_DATA=false
```

日常啟動：

```powershell
pnpm dev
```

`pnpm demo:check`只檢查這個loopback profile。它不接受 `--profile=lan`。

## 3. 區域網路 HTTPS

`lan_secure_demo`使用一個明確、已配置在本機介面上的RFC1918 IPv4。對外HTTPS listener預設使用3443，內部Next listener只綁定loopback的不同port。Browser不直接連線內部port。

必要條件：

- Root CA已由使用者明確同意後安裝於需要連線的裝置；Server憑證SAN包含實際IP。
- 憑證與私鑰位於repository外，私鑰ACL只允許目前使用者與必要SYSTEM principals。
- `RENTPROOF_PUBLIC_ORIGIN`、Allowed Host與Allowed Origin全部精確等於HTTPS網址。
- PostgreSQL只listen `127.0.0.1`／local socket，Firewall不開放資料庫port。
- 使用自建Auth、Secure／HttpOnly／SameSite Cookie與Server-side owner authorization。
- 上傳存入受保護的外部私有目錄，不進repository、`public/`、Documents／OneDrive、共享／網路磁碟或reparse point。
- Windows網路分類為Private；Firewall只開放指定本機IP、TCP 3443、Node程式與Private profile。
- 每次啟動明確確認Router沒有Port Forwarding、UPnP、DMZ，且沒有ngrok、Cloudflare Tunnel或公開reverse proxy。
- OpenAI Live模式必須有Server-only key、已確認的Project額度／速率限制與Application案件限制。

設定保存在不提交的 `.env.secure-lan.local`：

```env
RENTPROOF_DEPLOYMENT_PROFILE=lan_secure_demo
RENTPROOF_BIND_HOST=192.168.x.x
RENTPROOF_PORT=3443
RENTPROOF_INTERNAL_PORT=3100
RENTPROOF_PUBLIC_ORIGIN=https://192.168.x.x:3443
RENTPROOF_ALLOWED_HOSTS=192.168.x.x:3443
RENTPROOF_ALLOWED_ORIGINS=https://192.168.x.x:3443
RENTPROOF_ALLOW_REAL_DATA=true
RENTPROOF_AUTH_MODE=self_hosted
RENTPROOF_DATABASE_ADAPTER=postgres
RENTPROOF_DATABASE_ENVIRONMENT=secure_demo
RENTPROOF_DATABASE_ROLE=app
RENTPROOF_LLM_MODE=live
OPENAI_PROJECT_LIMITS_CONFIRMED=true
```

實際IP、密碼、token、資料庫URL、加密金鑰及憑證路徑不得提交。

啟動前與結束後：

```powershell
pnpm secure-lan:firewall:verify
pnpm secure-lan:firewall:enable
pnpm start:secure-lan
pnpm secure-lan:firewall:disable
pnpm secure-lan:firewall:verify
```

Firewall切換需要UAC，但Node App維持一般使用者權限。管理腳本只管理Firewall，不啟動Node或傳遞elevated環境。

## 4. TLS 與 Request Boundary

- TLS proxy只接受安全TLS版本與Server憑證；私鑰內容不輸出到log或response。
- 全域Gate在Auth與Route Handler之前驗證exact Host；mutation另驗證exact Origin、CSRF與owner。
- 不信任任意 `Forwarded`、`X-Forwarded-Host`、`X-Forwarded-Proto`或Client提供的來源IP。
- 不使用wildcard CORS。
- Case、artifact、report與Auth response使用`Cache-Control: private, no-store`。
- 設定CSP、`frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`與嚴格Referrer Policy。
- Session Cookie在HTTPS LAN使用`Secure`、`HttpOnly`、host-only及明確SameSite；token不進URL、資料庫明文或log。

## 5. 檔案、資料庫與清理

- JPEG／PNG與文字型PDF通過stream size、magic bytes／parser、來源定位與repository quota檢查後才available。
- 原檔存放於private runtime；圖片衍生檔重新編碼並移除EXIF／XMP／IPTC／GPS。
- PostgreSQL使用Kysely＋node-postgres adapter；Domain／Application只依賴typed repository ports。
- Migration只由獨立指令執行，不由Web startup或request自動執行。
- 訪客Session固定24小時；帳戶Session在合格主動使用時滑動延長7天。
- 案件或帳戶刪除後立即拒絕一般存取，再依Guest 24小時或Account 7日SLA執行冪等清理。
- Backup／PITR最多14天；Deletion tombstone保存21天並於restore前重播。

## 6. OpenAI

Fixture與Live模式仍須明確設定。Live時：

- `OPENAI_API_KEY`只由Server adapter讀取，不能出現在HTML、client bundle、source map、log或debug route。
- Request明確使用`store: false`與`service_tier: default`。
- 模型、reasoning、schema與prompt版本由Server allowlist決定，Browser不能覆寫。
- 失敗、拒答、incomplete、rate limit、schema invalid與locator failure保持不同typed reason code。
- Provider failure不得自動改用預先分析結果。

## 7. 啟動 Gate

`lan_secure_demo`任一條件失敗即停止啟動：

- Profile、IP、ports、HTTPS origin或exact allowlists不一致。
- 憑證、私鑰、CA、資料目錄或ACL檢查失敗。
- Firewall不存在、未啟用或scope不精確。
- 偵測舊HTTP LAN設定、wildcard／public bind、對外DB listener或公開Tunnel。
- Auth／PostgreSQL／owner／policy／storage／deletion設定不完整。
- Live模式未提供API key，或未確認OpenAI Project limits。

正式Production仍需要正式網域與受公眾信任的TLS、Transactional Email、異地加密備份、排程式清理、營運者法定資料、完整政策及台灣法務／隱私審閱；區域網路展示不等於Production已可上線。
