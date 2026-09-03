# PostgreSQL Synthetic Demo 操作手冊

本手冊只用於完全虛構資料的本機／LAN Demo。瀏覽器可以透過HTTP開啟RentProof，但PostgreSQL仍只能接受同一台電腦的loopback連線；不得將5432、5433或RentProof獨立cluster的55432開放給LAN。

## 建議：獨立User-owned PostgreSQL 18 cluster

RentProof提供不註冊Windows Service的獨立cluster manager，固定使用：

- `%LOCALAPPDATA%\RentProof\postgres-demo`，必須是exact path、fixed NTFS，所有既有parent都不可為reparse point。
- PostgreSQL 18已安裝binaries及loopback-only `127.0.0.1`／`::1`。
- 非衝突port `55432`；不修改既有5432／5433服務。
- 32-byte CSPRNG隨機admin／migration／app密碼與SCRAM-SHA-256，不使用trust或blank password。
- Ownership marker的root、port及目前Windows SID，並驗postmaster PID／PG18 executable／data-root containment。

操作順序：

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

`Initialize`、`Provision`與migration均可重跑；既有三欄secret檔會在重跑`Initialize`時原地加入一個獨立32-byte base64url Auth HMAC key，並重新產生固定欄位的private App env。Web process仍不自動migration。停止使用`pnpm db:demo -- Stop`。`Uninstall`只有exact marker／root／owner SID、fixed NTFS、整棵目錄無reparse point，且Auth Demo與postmaster皆已停止才會刪除；一般Demo不需執行。

`MigrationReadiness`只連線讀取server／role／schema權限狀態，不建立table或改schema。`Migrate`會實際套用凍結的Kysely migrations：001建立8張案件／政策tables，002建立4張self-hosted credential／session／challenge tables，另由Kysely維護2張migration metadata tables；即使是Synthetic Demo，也必須在執行前由使用者明確同意這項資料庫schema寫入。Reviewer拒絕或未取得同意時不得以其他命令繞過。

`Smoke`只使用App role及隨機opaque synthetic IDs，在單一transaction內暫時建立兩個合成identity、一個合成case，以及002的credential／session／Email verification／reset資料，驗證owner A list／detail／state load、owner B拒絕、CAS、7天session欄位與challenge tables。成功時在transaction內明確刪除；任何斷言或清理失敗會rollback全部insert，transaction結束後再查一次確認案件、identity、session與challenge皆無殘留。輸出只有typed結果，不包含ID、Email、state或credential，且不具migration權限。

Manager產生的`.env.postgres-demo.local`在外部cluster root，不在repository；只含固定allowlist的Synthetic Demo App role、loopback、Fixture及self-hosted Auth設定，不含admin／migration password。`cluster.secrets.json`只允許`admin`、`migration`、`app`與`authToken`四個欄位；App env也拒絕未知或重複key。兩個檔案都關閉ACL繼承並只允許目前user及SYSTEM，每次讀取前重新驗證ACL。不得用environment dump或debug輸出內容。

## 啟動Loopback Self-hosted Auth Demo

完成`Migrate`、`Finalize`、`Readiness`及Production Build後，才可由一般使用者PowerShell啟動：

```powershell
pnpm build
pnpm auth:demo -- StartAuthDemo
pnpm auth:demo -- StatusAuthDemo
pnpm auth:demo -- AuthHttpSmoke
pnpm auth:demo -- AuthHttpResidueCheck
```

Launcher固定使用現有Production Build、`127.0.0.1:3000`、Fixture LLM與`synthetic_only`，啟動前重驗ownership marker、private ACL、PostgreSQL process containment、12張產品tables及兩張migration metadata tables。DB URL與Auth HMAC key只以child-process environment傳遞，不出現在command line或輸出；若PowerShell已提升權限、port被占用、環境多出未知key或runtime health不是`self_hosted_local`，即fail closed。

停止時使用：

```powershell
pnpm auth:demo -- StopAuthDemo
```

Stop會先以private PID marker、Node executable、start time、repository root與port重新驗證process，再終止該process tree；不接受無marker的廣域process搜尋。本手冊的Auth流程只在loopback操作；LAN帳戶流程由獨立`lan_secure_demo` HTTPS profile管理。

`AuthHttpSmoke`只對已驗證且健康的managed loopback process執行。它以隨機`example.test` Email與隨機密碼完成CSRF／pre-auth Cookie、註冊、本機browser-bound mailbox、Email驗證、登入、passive session不滑動、history合格活動滑動Cookie、登出、reset及reset replay拒絕；最後只用精確生成的Email／internal user ID刪除該Synthetic帳戶，並確認credential、session及兩種challenge皆為零殘留。輸出只有`AUTH_HTTP_SYNTHETIC_SMOKE_OK`或typed failure code，不顯示Email、密碼、Cookie或一次性碼。

若Smoke失敗，可執行`AuthHttpResidueCheck`作唯讀aggregate診斷；它只回報所有`synthetic-auth-* @example.test`測試資料是否為零，不刪除資料、不輸出數量或identifier。Smoke失敗碼會區分session bootstrap、Auth runtime probe、register、verification mailbox、verify、login、passive session、history slide、logout、reset request、reset mailbox、reset complete與replay階段；非預期HTTP status只附數字，register另能區分本機cookie jar缺少／不一致的CSRF或pre-auth Cookie，但不附HTTP body、Cookie值或secret。

## 目前電腦的唯讀盤點

2026-09-03檢查結果：

- PostgreSQL 17在`0.0.0.0:5432`與`[::]:5432`監聽，不符合RentProof要求。不要用於RentProof，也不要為本Demo修改或停止該既有服務。
- PostgreSQL 18在`127.0.0.1:5433`與`[::1]:5433`監聽，符合loopback-only條件，Demo固定以`127.0.0.1:5433`為目標。
- 兩個listener都可接受TCP連線；無密碼／SSPI的唯讀登入測試被拒絕，因此建立資料庫前仍需由操作者提供既有PostgreSQL 18管理員憑證。Repository沒有也不應取得該憑證。

每次Demo設定前先重跑：

```powershell
pnpm db:listener:check -- 5433
```

只有輸出`POSTGRES_LISTENER_LOOPBACK_ONLY`才可繼續。若回`POSTGRES_LISTENER_EXPOSED`，停止設定；不要用程式自動修改`postgresql.conf`、Windows服務或Firewall。

## 建立資料庫與分離角色

使用PostgreSQL 18的`psql`連到loopback；讓`psql`互動提示管理員密碼，不把密碼放進command line或歷史：

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h 127.0.0.1 -p 5433 -U postgres -d postgres -X
```

在`psql`內執行：

```text
\i 'C:/path/to/RentProof/scripts/postgres-demo-bootstrap.sql'
\password rentproof_demo_migration
\password rentproof_demo_app
\quit
```

Bootstrap可重跑且不含密碼，會建立：

- `rentproof_demo_owner`：`NOLOGIN`資料庫owner。
- `rentproof_demo_migration`：只負責`rentproof`schema與migration，不是superuser、不能建立DB／role。
- `rentproof_demo_app`：只能使用schema及讀寫產品tables，不能建立schema object。
- `rentproof_demo`：撤銷`PUBLIC`連線與`public`schema create；兩個LOGIN role的`search_path`固定為`rentproof, pg_catalog`。

## Session限定的連線設定

`RENTPROOF_DATABASE_URL`必須透過本機secret注入方式提供，不能提交到repository、文件或log。以下PowerShell片段只在目前process tree記憶體建立URL；輸入不會回顯。完成操作後關閉該PowerShell，或明確移除環境變數。

```powershell
$rpDbSecret = Read-Host 'Migration role password' -AsSecureString
$rpDbPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($rpDbSecret)
try {
  $rpDbPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($rpDbPointer)
  $rpDbEncoded = [Uri]::EscapeDataString($rpDbPlain)
  $env:RENTPROOF_DATABASE_URL = "postgresql://rentproof_demo_migration:$rpDbEncoded@127.0.0.1:5433/rentproof_demo"
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($rpDbPointer)
  Remove-Variable rpDbPlain,rpDbEncoded,rpDbSecret,rpDbPointer -ErrorAction SilentlyContinue
}
$env:RENTPROOF_DATABASE_ADAPTER = 'postgres'
$env:RENTPROOF_DATABASE_ROLE = 'migration'
$env:RENTPROOF_DATABASE_ENVIRONMENT = 'synthetic_demo'
$env:RENTPROOF_DATABASE_MAX_CONNECTIONS = '1'
$env:RENTPROOF_DEPLOYMENT_PROFILE = 'local_development'
$env:RENTPROOF_ALLOW_REAL_DATA = 'false'
$env:RENTPROOF_PUBLIC_ORIGIN = 'http://127.0.0.1:3000'
```

環境變數仍可被同一使用者的高權限process讀取；正式環境必須改用受控secret manager。不要用`Get-ChildItem Env:`、debug dump或錯誤回報輸出它。

## Readiness、migration與ACL finalization

依序執行：

```powershell
pnpm db:check -- migration
pnpm db:migrate -- up
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h 127.0.0.1 -p 5433 -U rentproof_demo_migration -d rentproof_demo -X -f scripts/postgres-demo-finalize.sql
```

Finalization會撤銷App對Kysely migration metadata tables的存取，並明確補齊12張產品tables的DML權限。它不建立或修改使用者資料。

接著清除migration URL，使用同樣的SecureString流程注入`rentproof_demo_app`密碼，並把URL username改為`rentproof_demo_app`、設定：

```powershell
$env:RENTPROOF_DATABASE_ROLE = 'app'
pnpm db:check -- app
```

App readiness只有在下列條件都成立時成功：實際server address為loopback、database／role符合URL、role沒有superuser／createdb／createrole／bypassrls、`search_path`安全、12張產品tables存在、App不能CREATE schema且不能操作migration metadata。

操作完成後：

```powershell
Remove-Item Env:RENTPROOF_DATABASE_URL -ErrorAction SilentlyContinue
```

## 不在本手冊內的事項

- 不接受真實租約、地址、姓名、電話、證件、帳號或其他個資。
- 不修改既有PostgreSQL服務、listener、`pg_hba.conf`或Windows Firewall。
- 不建立off-host backup／PITR，也不宣稱HA或Production可用。
- 不讓Web process自動執行migration；`down`在`synthetic_demo`固定拒絕。
- Transactional Email provider與真實資料流程另有獨立外部Gate；PostgreSQL readiness成功不代表Production Email delivery或真實資料已可用。
