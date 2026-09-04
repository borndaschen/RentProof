# 掃描 PDF OCR 設計

- 狀態：P1 工程邊界已實作；尚未接入共用 upload route
- Stage：`contract.ocr`
- Provider：OpenAI Responses API，`gpt-5.6-terra`／`medium`
- Prompt／Schema：`contract.ocr.prompt.v1`／`rentproof.contract-ocr.v1`

## 目的與限制

掃描租約沒有可靠文字層時，RentProof 可先建立逐頁 OCR 候選，供使用者核對。OCR 不是契約解釋，也不能直接建立 `ContractClause`、`Finding`、官方規則結果或廣告承諾三態。

無論模型回報多少 confidence，OCR 候選都固定為 `humanVerificationRequired: true` 且 `mayProduceAffirmativeFindings: false`。只有另行完成 actor／case／revision／payload-hash 綁定的確認流程後，確認文字才可作為 `contract.extract` 的輸入。低 confidence、模糊頁、缺頁、重複頁、無文字、超過 300,000 Unicode code points 或 schema／locator 不合格，一律回 `insufficient_evidence`。

## 固定流程

1. Upload 層維持單份 PDF、15 MiB stream cap、magic bytes、owner 與 private storage Gate。
2. `ScannedPdfPreflightPort` 由 PDF.js adapter 實作，只讀 server 已驗證 bytes；確認 1–30 頁並拒絕加密、JavaScript／actions、附件、表單與外部連結。此步不要求文字層。
3. Preflight 通過後，`ScannedPdfOcrPort` 才可收到 bytes。OpenAI adapter 使用 inline `input_file`，不建立長期 Files API object、不接受 URL，固定 `tools: []`、`store: false`、`service_tier: default`。
4. Structured Output 回每頁品質、逐行文字、confidence 與 normalized bounding box。Server 重新驗證完整頁集合、bbox、文字長度與 quality。
5. `PrepareScannedPdfOcr` 回 `{ pageCount, assessment, provenance }`。`requires_confirmation` 只代表「可顯示供核對」，不代表可進判定。

## Application contract

```ts
const useCase = new PrepareScannedPdfOcr(preflightPort, ocrPort);

const result = await useCase.execute({
  caseId,
  artifactId,
  bytes,
});
```

Queue payload 只保存 opaque `caseId`／`artifactId` 與必要 revision，不放 PDF bytes、OCR 文字或檔名。Worker 執行時重新解析 actor／owner scope，從 private storage 取 bytes，並在 provider attempt 前完成 Cloud Processing Notice、PII／auth-secret、budget、idempotency 與 concurrency Gate。

## 錯誤與安全語意

- PDF preflight 延用 `PDF_*` typed errors；active content 永遠不因 OCR 而放行。
- Provider auth、rate limit、unavailable、refusal、incomplete 與 schema invalid 使用不同 `OCR_PROVIDER_*` reason codes。
- 技術失敗不轉成「沒有問題」；內容品質不足只產生 `insufficient_evidence`。
- 文件內容一律視為不受信任資料。Prompt 禁止遵循文件內指示、連結與角色宣稱。
- Auth secrets、完整金融帳號、QR payload 與 private key 不得由 OCR 輸出保存或送入後續抽取；正式整合仍須在 upload／pre-provider Gate 阻擋或遮蔽。
- 測試只使用程式生成的 synthetic bytes／provider response，不提交真實租約或個資。

OpenAI Responses API 的 request 支援 file input 與 Structured Outputs；實際模型及資料控制仍依每次部署時的官方文件與 Project 設定重新確認：

- [Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create)
- [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [API data controls](https://developers.openai.com/api/docs/guides/your-data)
