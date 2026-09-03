# PostgreSQL 與 Secure LAN 操作手冊

本手冊說明Windows開發電腦上的loopback測試環境，以及可處理私有租屋素材的`lan_secure_demo` HTTPS環境。兩者的PostgreSQL都只接受本機loopback連線；不得向LAN或Internet開放資料庫port。

## User-owned PostgreSQL 18 cluster

Repository提供不註冊Windows Service的cluster manager，固定使用`%LOCALAPPDATA%\RentProof\postgres-demo`、PostgreSQL 18、`127.0.0.1`／`::1`及port `55432`。它驗證fixed NTFS、無reparse point、owner SID、postmaster PID及PG18 executable，並使用分離的admin、migration與app roles及SCRAM-SHA-256密碼。

```powershell
pnpm db:demo -- Plan
pnpm db:demo -- Initialize
pnpm db:demo -- Start
pnpm db:demo -- Provision
pnpm db:demo -- MigrationReadiness
pnpm db:demo -- Migrate
pnpm db:demo -- Finalize
pnpm db:demo -- Readiness
pnpm db:demo -- Smoke
pnpm db:demo -- Status
```

`Migrate`必須由操作者明確同意後執行；Web process不會自動migration。停止使用`pnpm db:demo -- Stop`。

## Migrations與資料表

Kysely Migrator依序套用四個凍結、forward-only migrations：

1. `001_initial_real_data_schema`：8張案件、政策、刪除與稽核tables。
2. `002_self_hosted_auth`：4張credential、session、Email驗證與密碼重設tables。
3. `003_private_case_artifacts`：owner-scoped `case_artifacts`。
4. `004_guest_sessions`：保存keyed token digest與最長24小時固定expiry的`guest_sessions`。

App readiness必須看到14張產品tables及2張Kysely metadata tables，並證明App role不能建立schema或修改migration metadata。兩份finalize SQL都會補齊14張產品tables的最小DML權限。

```powershell
pnpm db:check -- migration
pnpm db:migrate -- up
pnpm db:check -- app
```

Migration與App檢查使用各自role的loopback `RENTPROOF_DATABASE_URL`；URL只由受ACL保護的本機secret檔或目前process tree注入，不得提交、回顯或寫入command line。

## Loopback Auth smoke

```powershell
pnpm build
pnpm auth:demo -- StartAuthDemo
pnpm auth:demo -- StatusAuthDemo
pnpm auth:demo -- AuthHttpSmoke
pnpm auth:demo -- AuthHttpResidueCheck
pnpm auth:demo -- StopAuthDemo
```

此流程只綁`127.0.0.1:3000`，驗證CSRF、註冊、驗證、登入、7天sliding session、history、登出、reset／replay拒絕及owner隔離。測試資料完成後清除，輸出不得包含Email、密碼、Cookie、驗證碼或identifier。

## Secure LAN私有素材

Secure LAN使用獨立`rentproof_secure_demo`資料庫與owner／migration／app roles。先由本機cluster管理員執行`scripts/postgres-secure-demo-bootstrap.sql`並互動設定密碼，再由migration role執行四個migrations及`scripts/postgres-secure-demo-finalize.sql`。

被ignore且限制NTFS ACL的`.env.secure-lan.local`至少設定：`lan_secure_demo`、`secure_demo`、App role、loopback DB URL、`RENTPROOF_ALLOW_REAL_DATA=true`、exact HTTPS origin／allowlists、RFC1918 bind、TLS材料、Auth／artifact encryption／proxy keys，以及`%LOCALAPPDATA%\RentProof\real-data`。Live另需server-only `OPENAI_API_KEY`與`OPENAI_PROJECT_LIMITS_CONFIRMED=true`。

```powershell
pnpm build
pnpm secure-lan:firewall:install-disabled
pnpm secure-lan:firewall:enable
pnpm secure-lan:firewall:verify
pnpm start:secure-lan
```

Launcher先驗證TLS憑證／SAN／私鑰、private storage、loopback database、exact Host／Origin、Firewall，以及本次無Port Forwarding、UPnP exposure或Tunnel，再把Next綁在內部loopback並由HTTPS listener提供服務。結束後停止server並執行`pnpm secure-lan:firewall:disable`。

原始與衍生檔只放private storage，不進repository或`public/`。所有case／artifact／history／analysis route都由Server解析guest／user session後執行owner-scoped query。Secure LAN仍不是Production核准；正式上線尚需Transactional Email、自動retention／purge、off-host backup／PITR、Production憑證與法務／隱私審閱。
