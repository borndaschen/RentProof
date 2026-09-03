# 公開儲存庫交付檢查

最後檢查：2026-09-03

## 目前結果

- [ ] GitHub／GitLab儲存庫可由無痕視窗直接開啟
  - 尚未符合：本機repository尚無remote與第一個commit，且GitHub CLI的`borndaschen`登入已失效。完成重新登入、建立Public repository及push後，必須再用未登入的無痕視窗驗證。
- [x] 儲存庫包含可辨識的實作內容
  - 預備提交包含`src/`、`scripts/`及`tests/`共400個實作／測試檔，其中121個為自動化測試檔；不是只有企劃文件或畫面稿。
- [x] README包含問題、功能、架構、技術、執行方式與限制
  - [`README.md`](../README.md)已有「解決的問題」、「核心功能」、「架構與技術」、「本機開發」及「限制與明確不做」段落。
- [x] 已加入明確的LICENSE檔案
  - 根目錄[`LICENSE`](../LICENSE)為完整Apache License 2.0，並附[`NOTICE`](../NOTICE)。
- [x] 第三方套件、模型、資料與素材的來源及授權已揭露
  - [`SOURCES_AND_ATTRIBUTIONS.md`](SOURCES_AND_ATTRIBUTIONS.md)集中說明OpenAI模型／服務、官方資料與外部Demo素材；[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md)記錄套件版本與授權；[`OFFICIAL_RULES.md`](OFFICIAL_RULES.md)及規則manifest保留官方URL與SHA-256。
- [x] 儲存庫內沒有API Key、Token、密碼或個人資料
  - `pnpm security:check`通過；目前446個staged檔案的高風險路徑、private-key／常見credential pattern及大於1MiB檔案掃描皆為零。公開前仍須對最終commit再掃描一次。
  - 自動化測試中的Email使用IANA保留的`example.com`、`example.test`或`example.invalid`網域；電話、身分證及密碼字串只用於驗證阻擋／遮蔽行為，不對應真實人物或帳戶。

## 明確不提交

- `.env`、`.env.local`、`.env.lan.local`及其他實際環境設定。
- OpenAI Key、GitHub Token、Auth token key、資料庫密碼與connection string。
- Root CA／TLS私鑰、Server憑證、PFX／P12。
- `node_modules`、`.pnpm-store`、`.next`、coverage、Playwright結果及TypeScript build cache。
- PostgreSQL data directory、Runtime、private uploads、logs與任何真實租屋素材。
- Repository外的Golden Demo圖片、契約與truth／fallback內容。
- 官方網站完整HTML／PDF快照；公開repository只留來源URL、雜湊與自行撰寫的規則／測試。

## Push後驗證

1. 以`gh repo view`確認visibility為`PUBLIC`。
2. 複製repository HTTPS URL，以未登入的瀏覽器無痕視窗開啟。
3. 確認README、LICENSE、來源揭露及`src/`可直接瀏覽。
4. 對遠端預設分支重新clone到新的空目錄，執行`pnpm install --frozen-lockfile`、format、lint、typecheck、tests、security check及build。
5. 在GitHub搜尋常見secret pattern，並確認push protection／secret scanning沒有警示。
