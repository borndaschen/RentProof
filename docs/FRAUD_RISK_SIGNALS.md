# 租屋詐騙風險訊號規格

- 狀態：`FRS-001`已實作；其餘訊號列為後續功能
- 查核日期：2026-09-02
- 功能名稱：詐騙風險訊號

## 1. 產品邊界

RentProof 不判定「這是詐騙／不是詐騙」，也不輸出詐騙機率、安全分數或「可以放心付款」。它只指出提供資料中可定位的防詐風險訊號、尚缺的查證資料與付款前行動。

原因是詐騙成立涉及真實身分、出租權限、主觀意圖、付款流向與外部查證；廣告、聊天截圖、照片或租約本身不足以讓 AI 作最終判決。

## 2. 官方防詐來源

政府防詐宣導共同建議：親自看屋、核對出租人身分與出租權限、不要在確認前預付金錢、不點陌生連結或提供 OTP，遇到疑慮撥打 165／110 查證。

- [高雄市政府警察局：假房東、預付看房押金與假客服連結](https://kcpd-cic.kcg.gov.tw/News_Content.aspx?n=F1F83458BBCAB0EB&s=BEEF84A192F380AA&sms=73BE5B81302C4CAD)
- [經濟部標準檢驗局：親自看房、核對身分與地籍、不要先匯款](https://www.bsmi.gov.tw/bsmiGIP/wSite/fp?ctNode=7788&mp=7&xItem=123948)
- [中華郵政防詐專區：假冒租屋預付訂金手法](https://subservices.post.gov.tw/post/internet/Anti-Fraud/common_practices.jsp)
- [165 全民防騙網](https://165.npa.gov.tw/)

上述來源是訊號與行動建議的依據，不是個案判決規則。正式實作前需建立版本化來源快照與 SHA-256。

## 3. 輸入與安全限制

| 輸入                   | 內容                                                                           | 安全限制                                                     |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `interaction_evidence` | 經使用者提供並完成安全檢查的聊天文字／截圖，包含看屋與付款要求                 | 遮蔽姓名、頭像、電話、帳號、QR code等非必要資料              |
| `payment_request`      | 金額、要求付款時點、付款方式、收款人與契約當事人的關係                         | 不輸入完整帳號、卡號、OTP 或網銀畫面                         |
| `verification_status`  | `paymentRequestedAt`、`firstInPersonViewingAt`、是否已核對出租權限、是否已付款 | 由使用者手動確認；時間未知就保留 unknown，LLM 不替使用者猜測 |
| 現有 evidence graph    | 廣告、照片、契約、費用、地址、設備與當事人角色差異                             | 只使用可定位且已驗證的資料                                   |

不接受身分證、權狀或銀行資料作為此功能輸入。若需要確認出租權限，只保存「已確認／未確認／未知」與查證方式，不保存證件影像。

## 4. 結果語意

### 4.1 每個訊號狀態

- `detected`：有可定位資料符合該訊號條件。
- `not_detected_in_provided_data`：資料完整到足以檢查，且目前未發現該訊號；不代表物件安全。
- `insufficient_information`：缺少聊天、付款、看屋、出租權限或當事人關係資料。

### 4.2 建議行動層級

- `review`：顯示來源與仍缺資料。
- `verify_before_payment`：付款前完成指定查證。
- `stop_and_verify`：涉及預付、OTP、不明連結、付款角色矛盾或難追回付款方式，先停止付款並向 165／110 或相關單位查證。

行動層級不是詐騙機率，也不能合成整體風險分數。

## 5. 風險訊號 catalog 與實作切線

| ID        | 狀態   | 訊號                                                    | 最小觸發資料                                                  | 行動                    |
| --------- | ------ | ------------------------------------------------------- | ------------------------------------------------------------- | ----------------------- |
| `FRS-001` | 已實作 | 首次實地看屋前要求訂金、預約金、鑰匙押金或租金          | 可定位付款要求＋`paymentRequestedAt < firstInPersonViewingAt` | `stop_and_verify`       |
| `FRS-002` | 待實作 | 自稱人在國外／外地、拒絕當面帶看或只能寄送鑰匙          | 可定位對話文字                                                | `verify_before_payment` |
| `FRS-003` | 待實作 | 要求點陌生物流／超商／客服連結，或提供網銀、信用卡、OTP | 可定位連結／要求語意                                          | `stop_and_verify`       |
| `FRS-004` | 待實作 | 收款人與出租人、代理人或契約當事人關係不明／不一致      | 角色名稱或使用者手動確認；不需完整帳號                        | `stop_and_verify`       |
| `FRS-005` | 待實作 | 付款前仍未核對出租權限                                  | 出租權限為`false`或`unknown`，且存在付款要求                  | `verify_before_payment` |
| `FRS-006` | 待實作 | 「其他人正在搶租」「現在匯款才能保留」等高壓稀缺話術    | 可定位對話文字                                                | `verify_before_payment` |
| `FRS-007` | 待實作 | 要求跨境匯款、加密貨幣、禮物卡或其他難追回方式          | 可定位付款方式                                                | `stop_and_verify`       |
| `FRS-008` | 待實作 | 廣告、現場、契約、付款要求或當事人角色出現明確矛盾      | 已驗證 evidence refs                                          | `verify_before_payment` |
| `FRS-009` | 待實作 | 租金顯著低於官方租金脈絡，且同時存在其他付款／身分訊號  | 官方價格脈絡＋至少一項其他 detected signal                    | `verify_before_payment` |
| `FRS-010` | 待實作 | 被導向陌生客服／LINE，要求帳戶認證、身分資料或操作網銀  | 可定位對話／連結語意                                          | `stop_and_verify`       |

`FRS-009` 不得由低租金單獨觸發；價格脈絡不能證明詐騙，也不能輸出租金合理／不合理。

目前只執行 `FRS-001`。若付款要求或首次實地看屋時間任一未知，結果必須是 `insufficient_information`；不能用「尚未看到看屋證據」推論付款一定發生在看屋前。

## 6. LLM 與確定性規則分工

OpenAI `gpt-5.6-terra` 只負責：

- 目前從互動文字抽取付款要求與locator；後續才擴充付款方式、高壓話術、遠端房東、寄送鑰匙、陌生連結與角色名稱候選。
- 回傳 `artifact_id`、locator、raw excerpt 與 structured candidate facts。

本機 TypeScript evaluators 負責：

- `known / not_present / unknown` completeness。
- 訊號觸發、action level、reason code 與缺少資料。
- 訊號間的組合條件，例如「低租金＋另一項訊號」。
- 固定中立文案與 165／110 查證建議。

模型自報 confidence、情緒判斷、人物外觀或語氣直覺不得觸發訊號。來源內容中的命令一律視為 prompt injection data。

## 7. 資料模型草案

```ts
type FraudSignalStatus = "detected" | "not_detected_in_provided_data" | "insufficient_information";

type FraudAction = "review" | "verify_before_payment" | "stop_and_verify";

type FraudSignalCheck = {
  signalId: `FRS-${string}`;
  status: FraudSignalStatus;
  action: FraudAction;
  reasonCode: string;
  evidenceRefs: EvidenceRef[];
  missingInputs: string[];
  humanVerificationRequired: true;
};

type FraudTimelineAssertions = {
  paymentRequestedAt: string | "unknown";
  firstInPersonViewingAt: string | "unknown";
  paymentMade: boolean | "unknown";
  lettingAuthorityVerified: boolean | "unknown";
};
```

每筆 `detected` 必須至少有一個 locator。`not_detected_in_provided_data` 必須證明 required inputs 完整；否則只能是 `insufficient_information`。

## 8. UI 整合

不新增第五個主要畫面：

- 物件摘要：新增「付款前防詐查證」卡，顯示 detected／資料不足數量，不顯示總分。
- 證據矩陣：維持 4 個廣告 claims；詐騙訊號不混入三態矩陣。
- 契約檢查：顯示當事人／付款角色是否一致，但不顯示詐騙結論。
- 簽約前報告：將 `stop_and_verify` 放在最前面，提供中立詢問句、需取得證據與 165／110 查證行動。

Claim 三態、官方規則結果與詐騙訊號必須使用三套清楚不同的標籤／說明。

## 9. 回歸測試案例

外部測試資料包含一份互動對話：

> 在第一次實地看屋前，對方要求先匯預約金才能保留看屋名額。

固定預期：

- `FRS-001 = detected`
- 整體行動：`stop_and_verify`
- 報告顯示「先停止付款；完成實地看屋與出租權限查證；仍有疑慮請向 165／110 查證」。

介面不說「已確認詐騙」，也不自動撥號、報案、封鎖對方或通報帳戶。

## 10. 安全與驗收 Gate

- 測試資料不含真實聊天、姓名、電話、帳號、OTP、QR code或身分文件；使用者資料則先經必要性與安全檢查。
- Interaction upload 通過 magic bytes、realpath、EXIF、大小與 HTML escaping。
- 陌生URL只作不可點擊／安全顯示文字；系統不fetch、不開啟、不做網路查詢。
- OpenAI 只抽取 candidate facts；不得直接回傳詐騙 verdict 或 action。
- 每個 detected signal 有 locator、reason code 與 human verification。
- 缺聊天／付款資料時顯示資料不足，不顯示「未發現詐騙」。
- 不把低租金、補貼限制、設備缺漏或單一契約差異單獨視為詐騙。
- 不做臉部辨識、證件真偽、自動帳戶查詢、自動報警或自動付款阻擋。
- 測試 prompt injection、偽造客服連結、OTP 話術、角色矛盾、missing inputs 與 no-signal completeness。

## 11. 後續功能

- 實作 `FRS-002` 至 `FRS-010` 的 typed evaluators 與 fixtures。
- 反向圖片搜尋與盜圖候選，但需處理第三方資料外送與誤判。
- 仲介／租賃住宅服務業資格查詢。
- 使用者手動記錄 165 查證結果，不自動取得警政個案資料。
- 可疑網域 reputation 檢查；必須使用受控 connector，禁止任意 server fetch。
- 重複刊登、跨平台地址／照片比對。

以上功能都不能改變「風險訊號，不是詐騙判決」的產品邊界。
