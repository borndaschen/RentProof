# OpenAI Cloud LLM 整合規格

- 狀態：provider and P0 default model accepted
- Provider：OpenAI API（Cloud）
- Endpoint：Responses API
- SDK：官方 OpenAI TypeScript SDK，僅在 server-side 使用
- Conversation model：`gpt-5.6-luna`／reasoning `low`
- Evidence extraction model：`gpt-5.6-terra`／reasoning `medium`
- Service tier：`default`（每次request明確指定）
- P0 case budget：16 provider attempts、concurrency 2、500K input tokens、50K output＋reasoning tokens、US$2 engineering alert
- Conversation budget：每case／non-sliding 24h window 200 Luna attempts、concurrency 1、500K input、100K output＋reasoning、US$0.50 engineering alert
- Development Project budget：US$100／month hard limit；US$50與US$80 spend alerts
- Development Project rate limits：30 RPM、500K TPM、40 IPM（若適用）、100 RPD
- Luna Development Project：30 RPM、500K TPM、300 RPD（若Dashboard支援）

## 1. 決策摘要

P0 只實作 OpenAI Cloud，不實作本機模型或第二個雲端 provider。程式仍保留窄的 `ModelGateway` interface，目的是隔離 SDK 與 domain，不是同時支援多家服務。

P0 Evidence extraction使用`gpt-5.6-terra`＋medium，因OpenAI官方將它定位為智慧與成本的平衡，且支援image input、Responses API與Structured Outputs：[GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)。Conversation intent／read-only explanation使用`gpt-5.6-luna`＋low；官方將Luna定位為成本敏感、高流量工作負載，並確認支援Responses與Structured Outputs：[GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)。

模型設定拆為`OPENAI_CONVERSATION_MODEL`／`OPENAI_CONVERSATION_REASONING_EFFORT`與`OPENAI_EVIDENCE_MODEL`／`OPENAI_EVIDENCE_REASONING_EFFORT`，只接受Luna／low與Terra／medium，不使用會自動改指向的latest alias。Conversation不自動升級Terra，Evidence也不降級Luna。

截至2026-09-02，OpenAI Docs列出的Terra標準價格為每1M tokens：input US$2、cached input US$0.20、output US$12。P0採寬鬆案件上限：最多16次provider attempts（包含SDK實際重試）、同時2個requests、累計500,000 input tokens與50,000 output＋reasoning tokens，應用層US$2／案件為工程警戒而非帳單保證。價格變更時更新估算，但不自動放寬token／attempt caps。

截至2026-09-02，Luna標準文字價格為input US$0.20、cached US$0.02、output US$1.20／1M tokens；Terra為US$2、US$0.20、US$12。Luna只用於Conversation，不用於Listing／Evidence／Contract；價格變動需更新工程估算，不自動改route。

OpenAI 官方文件確認 Responses API 可接受文字、圖片或檔案輸入，並產生 JSON Schema 結構化輸出：[Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)。官方模型目錄則列出目前支援 Responses API 與影像輸入的模型，實際可用性仍以專案帳戶為準：[Models](https://developers.openai.com/api/docs/models)。

## 2. 雲端與本機責任分工

| 階段                             | OpenAI Cloud                                                                             | 本機程式                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Listing                          | 從廣告圖片／文字抽取 claims 與 locator                                                   | schema 驗證、正規化、去重                                                       |
| Viewing                          | 不呼叫                                                                                   | 依 claim type 套用問題與拍攝模板                                                |
| Evidence                         | 從照片描述可觀察內容、confidence 與 locator                                              | 禁止負面推論、合併 observations                                                 |
| Contract                         | 從本機已抽取、帶頁碼的最小必要文字產生 clauses，以及專有部分非自然死亡的明確文件揭露候選 | PDF文字／頁碼抽取、locator逐字驗證、來源allowlist、確定性揭露核對與規則輸入組裝 |
| Fraud facts                      | P0 從 synthetic 互動抽取付款要求與 locator；時間線由使用者確認                           | `FRS-001` evaluator、行動與中立模板；其他訊號 P1                                |
| Conversation intent／explanation | Luna抽取strict intent candidates／source-bound read-only segments                        | policy、confirmation、cards、priority與所有material execution                   |
| Comparison                       | 不呼叫                                                                                   | 三態 truth table                                                                |
| Official rules                   | 不呼叫                                                                                   | 版本化 deterministic evaluators                                                 |
| Report                           | 不呼叫                                                                                   | reason code＋固定中立模板                                                       |

這樣把雲端模型限制在三種非結構化抽取工作，避免模型直接決定金額、三態、官方規則結果或法律措辭。

## 3. P0 呼叫設計

- Listing：一個 request，輸入廣告截圖／文字，輸出 `Claim[]`。
- Evidence：12 張照片分成小批次，每張都帶不可混淆的 `artifact_id`；一般房間照片先用 `detail: low`，文字／牆面重點照片用 `detail: high`。若跨圖 locator 混淆則改成單張 request。
- Contract：本機先從清楚文字 PDF 抽取帶頁碼文字，只把最小必要文字送入一個 request，產生`ContractClause[]`與獨立的`NonNaturalDeathDisclosureStatement[]`候選；掃描 PDF／頁面影像是 P1。後者只允許`contract_clause`與`signed_status_confirmation`，且必須具備專有部分、兩個固定期間、yes／no／unknown、明示事件類型、簽署狀態及逐字吻合的PDF locator。廣告、傳聞、新聞、地址搜尋、文件沉默或模型推論無法進入此provider schema。
- Fraud facts：一個 request，只接受 synthetic 互動文字／經遮蔽截圖，P0 只輸出付款要求 candidate＋locator；付款／首次看屋時間由使用者確認。不得輸出詐騙 verdict、機率或 action。
- 每個 stage 使用獨立 JSON Schema，不做一個包含整案的巨大 schema。
- Orchestrator在每次送出前原子reserve case budget；provider完成後以usage校正。沒有usage時標`unknown`並阻止可能超過剩餘hard cap的新request，不填0。
- 使用 foreground request，不使用 background、Conversations、Assistants、vector store、web search 或任意外部工具。
- `store: false` 明確設在每次 request，不依賴預設值。

Listing／Evidence 圖片由 server 端轉成 request image input，不先建立長期 Files API object。若未來需要 `/v1/files`，必須保存 `file_id`、設定到期或在 stage 完成後刪除。

## 4. ModelGateway contract

```ts
type ModelStageMap = {
  "conversation.intent": { input: ConversationIntentInput; output: ConversationIntentOutput };
  "conversation.explain": { input: ExplanationInput; output: ExplanationOutput };
  "listing.extract": { input: ListingModelInput; output: ListingCandidateOutput };
  "evidence.extract": { input: EvidenceBatchInput; output: EvidenceCandidateOutput };
  "contract.extract": { input: ContractTextInput; output: ContractCandidateOutput };
  "interaction.extract": { input: InteractionInput; output: PaymentCueOutput };
};

type ModelRequest<S extends keyof ModelStageMap> = {
  stage: S;
  input: ModelStageMap[S]["input"];
  inputHash: string;
  preprocessHash: string;
  model: "gpt-5.6-luna" | "gpt-5.6-terra";
  reasoningEffort: "low" | "medium";
  serviceTier: "default";
  imageDetail?: "low" | "high";
  promptVersion: string;
  schemaVersion: string;
};

type ExecutionOrigin =
  | { executionMode: "live"; provider: "openai" }
  | {
      executionMode: "fixture";
      provider: "fixture";
      recordedFrom: { provider: "openai"; model: string; snapshotSha256: string };
    };

type ModelResult<S extends keyof ModelStageMap> = ExecutionOrigin & {
  model: string;
  responseId?: string;
  output: ModelStageMap[S]["output"];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
  };
};

interface ModelGateway {
  extract<S extends keyof ModelStageMap>(request: ModelRequest<S>): Promise<ModelResult<S>>;
}
```

只有 adapter 可 import OpenAI SDK；domain、rules 與 UI 只依賴上述 contract。

## 5. 結構化輸出與 provenance

- Responses API 使用 JSON Schema Structured Outputs；回傳後再通過 Zod。
- Adapter 使用官方 SDK 的 parsed Structured Outputs helper；必須明確處理 `output_parsed` 缺失、refusal 與 incomplete，不讀自由文字作兜底。
- 每個輸出 item 都必須帶來源 `artifact_id` 與 locator；無 locator 不得成為肯定 finding。
- `contract.extract.prompt.v2`／`rentproof.terra-analysis.v2`將非自然死亡揭露放在專用typed field，不把它塞入一般`semanticKey`或自由文字。Adapter先驗case／artifact ownership及PDF code-point excerpt，再映射成domain statement；Client snapshot只取得server evaluator產生的`nonNaturalDeathDisclosure`結果，不取得未裁決的provider候選。
- Prompt、schema 與輸入素材都要版本化並計算 hash。
- Cache key 由 provider、requested model、reasoning effort、image detail／其他推論參數、stage、prompt／schema versions、input／preprocess hashes 組成；相同分析直接重用已驗證結果。
- 文件中的文字一律視為不受信任資料；developer instruction 明定忽略來源內命令。
- 不讓模型呼叫付款、訊息、檔案修改、web search 或其他工具。

## 6. 錯誤與重試

| 類型                            | 行為                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| 認證／權限                      | 回 `OPENAI_AUTH_ERROR`，不重試，不把 provider 原文顯示給使用者      |
| Rate limit／暫時性 server error | 只由 SDK 做有界重試；仍失敗則 stage error                           |
| Schema invalid                  | 不以自由文字修補；回 `MODEL_SCHEMA_INVALID`                         |
| Refusal                         | 保存 reason code，不把 refusal 當空結果或證據不足                   |
| Incomplete／無 parsed output    | `MODEL_INCOMPLETE`，不產生 finding                                  |
| 缺 locator                      | `MISSING_SOURCE_LOCATOR`，不產生肯定 finding                        |
| 網路中斷                        | Live mode 顯示失敗；只有操作者明確改用 Fixture mode 才載入 fallback |

SDK 的 retry 設定集中在 `OpenAIResponsesGateway`，adapter 不再疊加第二層 retry；400／401／403／422、refusal、schema 與 locator error 不重試。重跑前先查完整 stage run key，避免相同輸入重複付費；成功與 in-progress key 都不得重送。每次 provider request 保存 SDK request ID／response ID（若有）、stage、model、usage 與錯誤類型，但不保存完整 prompt 或原始租約到 log。

## 7. API Key 與秘密管理

- `OPENAI_API_KEY` 只存在 server environment／`.env.local`，不得進瀏覽器 bundle。
- Windows Development Key在Scaffold後只保存於repo-root `.env.local`；檔案必須ignore、限制NTFS ACL並接受source／build／test artifact secret scan，repository只放空值`.env.example`。Fixture mode不要求或讀取key、不組裝live adapter且network count為0；Production不沿用此檔案。
- `RENTPROOF_LLM_MODE` 必須明確為 `live` 或 `fixture`；fixture 不讀 key、不發網路，live 缺 key／model 立即 `MODEL_CONFIGURATION_MISSING`。
- `OPENAI_CONVERSATION_MODEL／REASONING_EFFORT`固定Luna／low，`OPENAI_EVIDENCE_MODEL／REASONING_EFFORT`固定Terra／medium；啟動時依route allowlist驗證，避免任意環境值導向未測模型或cross-route fallback。
- `OPENAI_SERVICE_TIER`固定為`default`；啟動與request都驗證，不使用`auto`繼承Project變更。Response實際tier進StageRun，與requested不符時標provider／configuration anomaly。
- 禁止使用 `NEXT_PUBLIC_OPENAI_API_KEY` 或從 client 直接呼叫 OpenAI。
- `.env.example` 的 key 保留空值；不得提交真實 key。
- Log、錯誤頁、分析 JSON 與測試 snapshot 都不得包含 key、Authorization header 或完整 provider response。
- 公開部署時使用平台 secret manager，並為 RentProof 建立獨立 OpenAI Project／key，以便限制存取與追蹤用量。
- 不提供可由使用者控制的 `base_url`；避免把租約或 API key 導向非 OpenAI endpoint。
- 真實資料版以 server secret 對內部 guest／user actor ID 作 HMAC 後提供穩定的 `safety_identifier`；不得傳 email、電話、session token或身分證號，也不得跨 owner 共用 identifier。
- `lan_secure_demo`可顯式使用Fixture或Live。Live必須啟用來源IP／case／request／concurrency limit及獨立OpenAI Project spend control；Browser到RentProof及RentProof到OpenAI皆使用HTTPS，key不得進source map、error overlay或任何LAN response。
- D-076允許LAN conversation free text；Fixture adapter本機處理且network count為0。Live intent request只含最小structured case projection＋目前turn，固定`tools: []`、`store: false`與strict JSON Schema output；不傳API key、system secret、raw documents或完整conversation history。Structured Outputs只保證schema shape，Server仍需allowlist語意與confirmation Gate。OpenAI API reference說明`json_schema`可強制符合所提供Schema，message roles具有指令優先序：[Responses API](https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses)。
- Conversation turn只有通過8 KiB raw UTF-8／NFC 2,000 code-point Gate才可進Live request；超限、invalid encoding或NUL不得呼叫OpenAI。長文件改走各自最小必要preprocessing／extraction request，不把全文偽裝成chat turn。
- Live conversation request還需通過Actor＋IP 10／minute、burst 3、case concurrency 1與idempotency Gate；duplicate同payload重用既有run，rate／concurrency／key conflict不得呼叫OpenAI或計入模型成功。
- Conversation response Structured Output限制assistant narrative 600 Unicode code points與最多3個typed card refs；Server再做NFC code-point、card union、snapshot ref與deterministic priority驗證。超限／無效不得截斷成看似成功，回`ASSISTANT_OUTPUT_SCHEMA_INVALID`。
- Conversation request不傳raw history；只傳current turn、versioned structured state與validated focus excerpts。Focus refs先做actor／case／snapshot／type Gate，context version／hash進provenance；ambiguous focus不呼叫模型。維持`store: false`且不使用OpenAI Conversations API。
- General PII warning只有payload-bound acknowledgement完成且Cloud Notice適用時才允許Live request；auth／recovery secret、API／session token、private key、完整金融帳號或QR／data URL命中時永不呼叫OpenAI。只記reason code／detector version，不記matched raw value。
- Hybrid assistant的OpenAI explanation request只讀verified facts／locator refs，strict output為source-bound segments，不能回cards／results／priority／CTA。Server template先行且模型無法覆蓋；refusal／incomplete／schema／ref／semantic eval failure顯示固定安全訊息，不使用provider prose fallback。

## 8. 資料保留與告知

所有 P0 呼叫設定 `store: false`。這表示應用不依賴 Responses API 保存 response 供日後 retrieve，但**不等於 Zero Data Retention**，也不代表所有監控資料立即刪除。

OpenAI 官方資料控制文件說明：API 資料預設不會用於訓練，除非客戶主動 opt in；但預設 abuse monitoring logs 可能包含客戶內容並保留一段期間，ZDR／Modified Abuse Monitoring 需要另行申請。圖片與檔案輸入也有額外安全掃描處理：[Data controls](https://developers.openai.com/api/docs/guides/your-data)。

Prompt caching 也可能在 GPU-local storage 保存加密 application state；background mode 會為 polling 暫存 response。P0 不使用 background，且不對使用者承諾 OpenAI「完全不保存」。

因此：

- P0 只傳完全虛構 Demo 資料。
- 真實產品上線前，介面必須告知資料會送往 OpenAI Cloud，並完成同意、資料最小化與保留政策。
- 不宣稱 `store: false` 等同不留資料。
- 不把真實證件、人臉、簽名、電話、完整門牌或無關私人照片送入 API。
- 若未來使用 Files API，需實作刪除／到期策略並驗證實際帳戶資料控制設定。

## 9. 可觀測性與成本

每個 cloud `StageRun` 至少保存：

- `provider = openai`
- model ID
- reasoning effort
- stage
- prompt／schema version
- input hashes
- preprocess hash、image count／detail、submitted bytes、PDF page count
- response／request ID（若可取得）
- input、output、cached token usage（若回傳）
- retry count、result status、error code
- 產生 findings 的數量與 locator coverage

成本顯示只作工程觀測，不用估算值取代 provider 帳單。若 usage 不可得，記錄 `unknown`，不要填 0。

Application case budget與OpenAI Project rate／hard-spend limit兩層並行；案件超過16 attempts、500K input、50K output＋reasoning或US$2警戒即停止新Stage。

Conversation Luna使用分離budget window：第一個reservation起固定24小時，200 actual attempts／500K input／100K output＋reasoning、concurrency 1。Pre-request原子reserve、post-response usage reconcile；unknown usage保守阻止可能超限request。Server templates／Fixture／pre-provider reject／idempotent reuse不扣attempt；hard cap後不fallback Terra。

Development Project月額固定為US$100 Hard Spend Limit，並設US$50與US$80 alerts。它在OpenAI Project管理層配置，不把Admin API key放入RentProof runtime、env example、CI或server。App只使用該Project的scoped service key；Production另建Project，不能沿用Development US$100額度或key。

Development Project對Terra設定30 RPM、500,000 TPM、40 images/minute（只有Project／model回傳該欄位時）與100 requests/day。這是provider層上限；Application仍限制concurrency 2、每案件16 attempts與token budget。若帳戶Usage Tier允許值更低，以provider較低上限為準；不得自動提高、分散到其他Project或重試規避。

Development Project對Luna設定30 RPM、500,000 TPM及Dashboard若支援則300 RPD；若無RPD欄位，由Actor／IP rate與每case fixed-window 200 calls控制。Project limit不取代Application Gate，且不得升Tier／拆Project／換key規避。Production另用獨立Project。

## 10. 驗收條件

- 瀏覽器 bundle 不含 `OPENAI_API_KEY`。
- Listing／Evidence／Contract 都以 Responses API Structured Outputs 通過 Zod。
- 預設模型、reasoning effort、image detail 與其他推論參數都進 StageRun、cache key、AnalysisSnapshot 與 fallback provenance。
- 相同輸入與版本可重用已驗證結果，不重複呼叫。
- 所有肯定 finding 具有 locator。
- 模型 refusal、schema invalid、rate limit 與網路失敗不會被誤顯示為「沒有問題」。
- Demo fallback 明確標示為預先分析結果。
- Live／fixture mode 明確；OpenAI 失敗不會偷偷切換 fallback。
- UI 與隱私說明清楚標示資料由 OpenAI Cloud 處理。
- `docs/SECURITY_PRIVACY.md` 的 OpenAI 與 P0 Security Gate 全部通過。
