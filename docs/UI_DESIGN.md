# RentProof UI／RWD 設計規格

- 狀態：目前設計基線＋後續正式服務帳戶流程
- 日期：2026-09-02
- 風格：簡單、乾淨、極簡主義、證據優先
- 策略：mobile-first responsive web design
- 元件基礎：shadcn/ui＋Radix Primitives，僅加入需要元件並以 RentProof tokens 重設視覺

## 1. 設計原則

1. 一個畫面只回答一個主要問題。
2. 證據與行動優先，裝飾與模型術語退後。
3. 白底、低噪音、清楚層級；不使用漸層、玻璃擬態、重陰影或大面積警示色。
4. 不用顏色單獨表達結果；狀態必須同時有文字與 icon／shape。
5. 不顯示整體風險分數、模型信心百分比或「可以放心簽約」。
6. Mobile 不縮小 desktop table；改為適合窄螢幕的 card／accordion。
7. RWD、keyboard、screen reader與print是基本品質要求，不是事後補強。

## 2. 視覺語言

### 2.1 Color

- Background：接近白色的 neutral surface。
- Primary text：高對比深灰，不用純黑大面積。
- Secondary text／borders：中性灰。
- Accent：單一藍色，用於主要操作、連結與 focus。
- Claim status：支持／矛盾／證據不足各有文字＋icon；色彩只作輔助。
- Rule status：使用另一套 outline badge，不沿用 Claim status 色塊。
- Fraud signal：`stop_and_verify` 使用克制的警示色與明確動詞，不以紅色大面積渲染恐懼。

### 2.2 Typography

- 使用支援繁體中文的 system sans-serif stack。
- Body 以可讀性為主，不使用極細字重。
- 主要層級只有 page title、section title、body、caption 四級。
- 數字與金額使用 tabular numbers，方便比較。

| Token             |     Mobile |    Desktop | Line height |
| ----------------- | ---------: | ---------: | ----------: |
| Page title        |      28 px |      32 px |        1.25 |
| Section title     |      20 px |      24 px |        1.35 |
| Card title        |      17 px |      18 px |         1.4 |
| Body／table       |      16 px |   16–17 px |     1.6–1.7 |
| Caption／metadata | 最小 14 px | 最小 14 px |         1.5 |

- 不以 12 px 小字塞入來源、版本或法律提示；次要資訊仍不得小於 14 px。
- 中文長文行寬控制在約 38–44 個全形字；一般 prose container 不超過 68ch。
- 長 URL、reason code、金額與中文不使用不可回復的 ellipsis；允許換行或提供展開。

### 2.3 Spacing／shape

- 採 4／8 px spacing scale。
- Cards 以 1 px border 為主，shadow 只在需要浮層時使用。
- Border radius 保持一致，不混用大量不同弧度。
- 每個 section 留足白空間；相鄰卡片不使用多餘分隔線。
- Mobile section 間距至少 24 px，Desktop 至少 32 px；card 內距至少 16 px。
- Card／table row 的主要內容不可低於 52 px 高度，避免文字與按鈕擁擠。
- Badge、按鈕與 metadata 可以換行；不得為維持單行而縮小字體。
- 目前不提供compact／dense mode。

## 3. Responsive breakpoints

| Profile | Viewport     | Layout                                                      |
| ------- | ------------ | ----------------------------------------------------------- |
| Mobile  | `< 768px`    | 單欄conversation、stacked cards、full-screen workspace      |
| Tablet  | `768–1023px` | Conversation主欄＋drawer workspace／evidence viewer         |
| Desktop | `>= 1024px`  | 最大內容寬度1280 px、conversation窄主欄＋可選side workspace |

內容不能依 breakpoint 消失，只能改變順序、密度或互動方式。

## 4. App shell

### Desktop

```text
┌──────────────────────────────────────────────────────────────┐
│ RentProof                                      我的案件     │
├──────────────────────────────────────────────────────────────┤
│ 對話                                             [證據工作區]│
├──────────────────────────────────────────────────────────────┤
│  Conversation timeline              Optional workspace panel│
│  upload／confirm／finding cards       摘要│矩陣│契約│報告    │
│  Composer                                                    │
└──────────────────────────────────────────────────────────────┘
```

### Mobile

```text
┌──────────────────────┐
│ RentProof   帳戶     │
│ 我的租屋案件         │
├──────────────────────┤
│ 對話       [證據工作區]│
├──────────────────────┤
│ timeline             │
│ structured cards     │
│                      │
├──────────────────────┤
│ 輸入／Quick replies  │
└──────────────────────┘
```

- Case title、execution mode 與 analysis state 始終可見。
- Workspace內四個tabs在Mobile可水平捲動，但conversation與內容本身不得產生全頁水平捲動。
- 對話是案件預設主畫面；四區Evidence Workspace保留摘要、矩陣、契約、報告，不新增第五個workspace tab。Viewing checklist、現場觀察與付款前查證可在對話卡與對應workspace投影呈現。
- 租金補貼申請條件預檢使用獨立`/rent-subsidy`頁面，由首頁提供明確入口；它不是第五個Evidence Workspace tab，也不得把RP-010契約限制與申請人條件混成單一結果。
- 一般使用者畫面不顯示內部profile、Fixture、Golden或規則階段名稱；開發狀態只放在操作人員可見的診斷資訊。
- 目前沒有公開HTTP展示profile；私人LAN只由`lan_secure_demo`以HTTPS提供，內部profile名稱不出現在一般使用者畫面。

### Single-entry production flow

真實資料版不建立「訪客站」與「會員站」兩個入口。所有人從同一首頁／建立案件 CTA 進入：

```text
┌──────────────────────────────────────────────────────────────┐
│ RentProof                              [登入／註冊]          │
├──────────────────────────────────────────────────────────────┤
│ 跟著對話加入案件名稱、廣告、看屋照片與租約                 │
│ [直接開始]                              [登入／註冊]        │
├──────────────────────────────────────────────────────────────┤
│                 對話主流程＋可開啟四區證據工作區            │
└──────────────────────────────────────────────────────────────┘
```

- 訪客工作階段由Server在同一入口自動建立；不得以disabled upload、強制modal或dark pattern迫使註冊。
- 首頁直接以對話依序引導案件名稱、租屋廣告、看屋照片與租約；登入／註冊是保存與查詢歷史的選用功能。
- 訪客報告頁提供「下載報告」與「登入／註冊並保存」，並顯示固定24小時Session的明確到期時間；到期後不可存取，線上案件資料於24小時內purge。
- 登入案件的history與detail提供清楚的「下載」與「刪除案件」動作；不顯示24個月到期日、到期通知或延長按鈕。刪除確認需說明會立即停止存取、不可恢復，且線上case／artifact／report等資料最多7個日曆日完成清除；未完成所有targets不得顯示「已完全刪除」。
- 已登入header顯示「歷史案件」與account menu；案件預設回到對話，Evidence Workspace仍只有摘要、證據矩陣、契約檢查、簽約前報告四區。

### Auth panel 與忘記密碼

- 登入、註冊與忘記密碼在同一 `/auth` panel／route 內切換，不作兩個互斥入口。
- Mobile 使用 full-screen dialog／route；Desktop 使用寬度受限的單欄 dialog／page，正文與欄位不壓縮。
- 忘記密碼初期只顯示Email；不顯示停用的SMS Tab／phone欄位。畫面對帳戶存在與否使用相同回覆。
- OTP／reset link 輸入提供到期、重送冷卻與嘗試失敗的中立狀態，不顯示帳戶是否存在。
- 設定新密碼完成後回登入畫面，不自動登入；清楚提示舊 sessions 已撤銷。
- Reset完成畫面只在Server以單一transaction確認challenge已consume、密碼hash已更新且該帳戶全部sessions均已撤銷後顯示；CTA只有「返回登入」。若任一步失敗，顯示安全處理尚未完成與重試／聯絡方式，不導向案件。
- 註冊時 Terms acceptance、Privacy Notice acknowledgement 分開呈現；Cloud Processing Notice 在第一次 live analysis 前顯示；非必要 Cookie 不放在註冊必選區。

### 歷史案件與政策頁

- `/history` 只對登入者顯示：Desktop 使用 quiet table／list，Mobile 使用單欄 cards。
- 清單只顯示案件名稱、概略地區、更新時間、分析狀態與待處理數，不顯示契約原文、照片或聊天摘要。
- Guest 開啟歷史入口時顯示 `AUTH_REQUIRED_FOR_HISTORY` 對應說明與選用登入／註冊，不把它偽裝成空清單。
- `/privacy`、`/terms`、`/cookies` 公開可讀、可列印，顯示草案狀態與更新摘要；正文至少16 px，長文行寬不超過68ch。
- 所有頁面 footer 都能到三份政策與 Cookie 設定，連結不得以低對比或小於 14 px 隱藏。

## 5. 對話主畫面與四區Workspace RWD

### 5.0 Conversation shell

- Desktop：對話欄最大閱讀寬度約760 px；Workspace以右側panel或明確次要view開啟，不把聊天與完整矩陣硬塞成三欄Dashboard。
- Mobile：單欄timeline＋底部composer；Workspace使用full-screen route／sheet，返回後保留conversation位置與focus。
- Timeline block只允許validated text、UploadCard、CandidateConfirmationCard、FindingCard、EvidenceLocatorCard、FollowUpCard與ReportActionCard等allowlisted union，不渲染模型提供的raw HTML／script／iframe。
- 每輪只突出一個主要下一步；卡片可展開來源，但不在對話中複製完整契約或全部矩陣。
- Material candidate需有「確認並加入案件」與「修改」；未確認狀態使用明確pending樣式，不得顯示成supported／contradicted或規則結果。
- 單一自由文字 composer 是主要輸入；卡片與 quick replies 僅作輔助。所有核心操作皆可用自由文字與鍵盤完成。來源 URL 可接受公開 allowlisted HTTPS 租屋頁面，顯示擷取中／失敗狀態；失敗時引導上傳截圖或貼文。Enter／Shift+Enter行為需明示，IME composition期間不得誤送，送出中保留可理解狀態且避免重複turn。
- Secure LAN使用HTTPS；PII／injection疑慮被拒時提供中立原因與安全改寫建議，不顯示內部prompt或偵測規則。Auth secret hard block只提供移除敏感內容，不提供繼續按鈕。
- Timeline對7天內raw text正常顯示；清除後只呈現保留的typed cards／events，必要位置使用中立placeholder「原始訊息已依保存政策清除」。不將typed candidate反向生成成使用者原句，也不提供raw聊天全文搜尋。
- Server狀態／安全／確認cards與AI read-only explanation使用一致但可辨識的label；不可讓AI說明覆蓋或視覺弱化blocking Server card。AI explanation每段的「查看來源」連到validated locator，無來源時只能顯示資料不足。
- Composer顯示2,000 code-point計數與接近上限狀態；Client不得用UTF-16 length冒充Server結果。超限保留使用者本機草稿並提示改用檔案上傳，但不得自動截斷、摘要或送出部分文字。
- 每case送出中只允許一則in-flight，Send顯示明確processing且避免double submit；429／in-progress保留本機草稿、顯示可重試時間與Retry動作，不用無限spinner或自動緊密重送。
- Assistant每輪最多600 code points與3張cards；若有更多項目，顯示安靜的「另有N項」與Workspace CTA。不得用小字、巢狀carousel或一次展開全部內容繞過限制。
- CandidateConfirmationCard顯示10分鐘到期時間／狀態，不以倒數造成壓迫；expired／stale／used分別說明。Confirm送出中disable重複操作，失效時提供「依目前案件重新產生」而非復活舊ID。
- 每張可追問的assistant card提供明確「針對這項提問」動作以建立FocusRef；一般composer沿用目前唯一active focus並可清除。多個可能focus時顯示選擇卡，不把舊聊天全文送模型或暗中猜測。
- Screen reader不把整段history設為持續`aria-live`；只播報最新狀態摘要，composer、upload progress、confirm／undo focus順序需可預期。
- Report由結構化composer產生，不列印conversation transcript；「查看證據工作區」是次要動作而非第五個主tab。

### 5.1 物件摘要

回答：「目前已知什麼？下一步是什麼？」

Desktop：

- 左欄：租金／固定費用／變動公式／一次性費用。
- 右欄：前三項待處理、付款前防詐查證、Viewing checklist。
- 下方：設備／廣告承諾與現場觀察摘要。

Mobile：

1. 最優先 action card。
2. 費用摘要。
3. 待處理 claims／observations／rules／FRS-001。
4. Viewing checklist。

重要動作不放在橫向 carousel。

### 5.2 證據矩陣

Desktop 使用真正的 semantic table：廣告、現場、契約、結果。

Mobile 改為每個 Claim 一張 card：

```text
洗衣機                           證據不足
廣告    附洗衣機
現場    拍攝範圍未涵蓋
契約    設備附件未列
[查看來源] [加入確認清單]
```

- 不把四欄硬塞進窄螢幕。
- 點擊來源後，Desktop 使用 side panel；Mobile 使用 full-screen dialog／bottom sheet。
- 電費矛盾需能並排／連續顯示廣告 NT$5 與契約頁碼 NT$6。
- 牆面觀察放在矩陣下方獨立 section，不偽裝成 Claim。

### 5.3 契約檢查

Desktop：左側 clause／page preview，右側 RuleCheck 與官方來源。

Mobile：

- RuleCheck card 在上。
- 點「查看契約原文」展開 page／excerpt dialog。
- 官方規則來源另以 disclosure 顯示版本、日期與 snapshot hash。

Claim 三態與 RuleCheck badge 不共用元件 variant。

### 5.4 簽約前報告

單欄閱讀，Desktop／Mobile 順序一致：

1. `stop_and_verify`。
2. 明確來源矛盾。
3. 官方規則疑似差異。
4. 補拍／補件／待詢問。
5. 雙方確認欄。

Action card 欄位：動作、對象、中立詢問句、所需證據、原因、來源、完成條件與狀態。

## 6. Component inventory

實作採 shadcn/ui＋Radix Primitives。shadcn 只作可維護的元件原始碼起點，不能直接套用完整 Dashboard／預設密集版面；Radix 提供 Dialog、Tabs、Accordion、Checkbox、Select 等互動行為與 accessibility primitives。所有色彩、字級、間距、狀態與 RWD variants 仍以本文件為準。

| Component                   | 用途                                            | RWD                                              |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `AppShell`                  | Header＋conversation primary＋Workspace入口     | Mobile compact header                            |
| `ConversationTimeline`      | Validated assistant／user blocks與狀態卡        | Desktop narrow column、Mobile single column      |
| `ConversationComposer`      | Multi-line自由文字＋附件入口；suggestions僅輔助 | Sticky mobile composer；至少16 px input          |
| `CandidateConfirmationCard` | Typed candidate確認／修改                       | Material change未確認不得寫case                  |
| `EvidenceWorkspace`         | 摘要／矩陣／契約／報告四區                      | Desktop side／secondary view、Mobile full-screen |
| `CloudProcessingNotice`     | OpenAI Cloud資料處理告知                        | 首次建立案件時明確確認                           |
| `AnalysisStageStatus`       | 準備／OpenAI／驗證／規則／完成／失敗            | Text＋icon；不可只用 spinner                     |
| `CostSummary`               | 固定／變動／一次性                              | Desktop grid、Mobile stack                       |
| `ClaimStatusBadge`          | 三態                                            | 專屬 semantics                                   |
| `RuleStatusBadge`           | RuleCheck 三結果                                | outline semantics                                |
| `FraudSignalBadge`          | detected／insufficient                          | 不輸出風險分數                                   |
| `EvidenceLocatorLink`       | 開啟 image／page／excerpt                       | Side panel 或 dialog                             |
| `ActionCard`                | 可完成的簽約前行動                              | 全寬 mobile                                      |
| `EvidenceProgress`          | 已取得／仍缺證據                                | checklist，不用 confidence bar                   |
| `DraftRulesNotice`          | 規則草案狀態                                    | Rule page／report                                |
| `GuestAccountAction`        | 提供選用登入／註冊與保存紀錄入口                | 不阻擋訪客開始                                   |
| `AuthPanel`                 | 登入／註冊／忘記密碼單一流程                    | Desktop dialog／page、Mobile full-screen         |
| `PasswordResetFlow`         | Email／SMS challenge 與新密碼                   | Generic response，不洩漏帳戶存在性               |
| `PolicyAcceptanceGroup`     | 分開顯示 Terms／Privacy／Cloud events           | 不預先勾選、不綁 Cookie                          |
| `PolicyFooter`              | 三份政策與 Cookie 設定                          | 所有 viewport 可讀                               |

## 7. Interaction states

每個資料區塊都要有：

- Empty：尚未提供，不顯示「沒有問題」。
- Loading：顯示具名 stage，不只 spinner。
- Success：顯示 snapshot／source mode。
- Partial：已完成部分資料，但指出仍缺項目。
- Failed：stable error＋可重試／補件行動。
- Stale：保留舊 snapshot 但標示新分析失敗／尚未完成。

Fixture mode 需要持續 banner，不可只顯示一次 toast。

## 8. Accessibility

- 目標至少 WCAG 2.2 AA。
- Body／UI text 具足夠對比；狀態不用顏色單獨傳達。
- 所有操作可 keyboard 完成，focus ring 清楚可見。
- Touch target 至少 44 × 44 CSS px。
- Dialog 開啟時管理 focus，關閉後回原觸發元件。
- Table 有 caption／headers；Mobile card 保留同等語意標籤。
- 圖片有可理解 alt；純裝飾 icon `aria-hidden`。
- 支援`prefers-reduced-motion`；任何功能都不依賴animation才能理解狀態。
- 錯誤訊息用 `aria-live` 適度宣布，不重複洗版。

## 9. Minimalism guardrails

- 不加入 dashboard chart、儀表盤、風險圓環或 score gauge。
- 不使用無功能 hero illustration、影片背景或 loading 動畫。
- 每頁只保留一個主要 CTA。
- 任何 icon 都必須搭配 accessible label 或可見文字。
- Advanced metadata 收在「分析詳情」，不放首屏。
- 一個 card 只保留一個主結論與一組主要操作；次要 evidence 收進 disclosure。
- 不用連續三層以上巢狀 cards；以 section、border 與留白建立層級。
- 官方來源、版本、hash 完整保留，但以 disclosure 呈現。

## 10. Security／privacy UI

- Upload 前顯示 synthetic-only 與 OpenAI Cloud 處理告知。
- 不在 URL、localStorage、IndexedDB 或 client logs 放 case data。
- 所有敏感 response `Cache-Control: private, no-store`。
- 可疑互動 URL 顯示為 escaped inert text，不可點擊／preview。
- 模型／stage failure 不得呈現為「未發現矛盾／訊號」。
- 規則草案、Fixture mode、stale snapshot 都要持續可見。
- Guest notice 不得暗示未登入資料為公開，也不得宣稱 session 遺失後仍能由客服找回。
- Email password reset的成功／失敗回應不能洩漏帳戶是否存在；reset code不回顯、不進URL。SMS／phone UI在Hobby初期不存在。
- 第一個 production release 不載入 analytics／marketing scripts；未來非必要 Cookie 在 opt-in 前不得載入。
- `lan_secure_demo`使用HTTPS並可顯示登入、註冊、Email密碼重設與歷史入口；這些流程仍須由Server驗證owner、session與policy，不能只靠Client顯示狀態。
- Public HTTP Showcase只有tabs／disclosures／print等無狀態互動；沒有forms、uploads、auth、cookies、history或「開始分析」CTA，並設定noindex。

## 11. Print

- A4 portrait，隱藏 app navigation、buttons、dialogs 與 analysis metadata。
- 保留報告標題、case display name、snapshot／ruleset version、來源文字與 URL。
- Action card、table row 不在關鍵內容中間 page-break。
- 顏色轉灰階後仍能分辨狀態。
- 不列印原始聊天、完整圖片或不必要個資。

## 12. RWD validation matrix

至少驗證：

- 360 px mobile portrait。
- 390 px mobile portrait。
- 768 px tablet portrait。
- 1024 px desktop／tablet landscape。
- 1440 px desktop。
- Browser zoom 200%。
- Reduced motion、keyboard only、screen reader smoke。
- A4 print preview。

通過條件：

- 無全頁水平 overflow。
- 對話主畫面與Workspace四區均可達。
- 任何來源、狀態與主要動作不因 viewport 消失。
- Mobile matrix card 與 desktop table 呈現相同資料與結果。
- Dialog／drawer 不遮住 close／back 操作。
- 長中文、URL、金額與 reason code 不破版。
- 200% zoom 後正文仍保持可讀字級，不重疊、不裁切，主要操作不被擠出 viewport。
- Guest notice、Auth panel、Email驗證／reset、歷史清單與三份政策頁在Mobile／Desktop都不擁擠且keyboard可完成；SMS／phone控制項不存在。
- 在實際LAN手機與桌面瀏覽器驗證HTTPS URL、憑證信任、exact Host／Origin rejection、Auth、訪客工作階段與私有上傳。

## 13. Frontend architecture implications

- Server Components為預設；conversation composer／focus、workspace tabs、dialogs、upload／follow-up progress等必要互動使用Client Components。
- UI 只接收 view models，不接觸 OpenAI SDK、repository、private path 或 provider response。
- View model 同時提供 semantic label 與 visual variant，不能讓 client 自行重新判斷狀態。
- Conversation result cards與四區workspace固定讀同一`snapshotId`；follow-up新snapshot完成後才整體切換。
- Shared component 不包含 domain evaluator；ActionCard priority 在 server report composer 完成。
- Tailwind tokens 集中管理，不在 component 內散落任意色碼與 spacing。
- shadcn generated source 放在 `src/components/ui/` 或等價內部目錄；feature modules 透過 RentProof wrappers／variants 使用，不直接複製多套風格。
- 只允許官方 shadcn registry／已審查 Radix packages；第三方 registry snippet 視為不受信任程式碼，未經 dependency／source review 不加入。
- Client 不自行推導 guest／user owner；server view model 提供 actor state、history availability 與可用動作。
- 租金補貼預檢結果卡與15項明細依Server狀態使用不同左側語意線：初步相符採accent、有待確認採warning、資料不足採muted；不得所有結果都使用成功色。來源過期需顯示「官方資料待更新」，不能落入一般連線錯誤或空結果。

## 14. UI Definition of Done

- Mobile-first conversation與四區workspace完整可用，Desktop不只是放大版Mobile。
- 證據矩陣有 Desktop table 與 Mobile card 兩種等價 representation。
- Claim／Rule／Fraud 三種結果語意清楚分離。
- 至少一次 side-by-side locator 與一次補證進度可展示。
- Empty／partial／failed／stale／fixture states 都有明確畫面。
- WCAG、RWD matrix、print、安全 headers 與 no-cache 行為通過測試。
- 頁面保持極簡：無 score、無重型圖表、無不必要動畫或裝飾。
- 正文、caption、table 與 action card 符合字級／行高／行寬／留白規則，不以縮字解決排版問題。
- 真實資料版維持單一入口；訪客可完成主流程且得到無歷史提醒，登入／註冊後才出現 owner-scoped 歷史清單。
- 登入／註冊／Email 或 SMS 忘記密碼流程與政策頁通過 keyboard、screen reader、generic-response 及 RWD 驗收。
- shadcn／Radix Dialog、Tabs、Accordion、Checkbox／Select 的 focus、keyboard、label、aria 與 200% zoom 通過測試；CLI 更新不得靜默覆寫 RentProof 客製化。
- Component層以Testing Library／user-event／jest-dom／axe驗證semantic role、label、keyboard與focus狀態；Browser層以Playwright／axe驗證真實layout、contrast、dialogs與RWD。Axe通過不等於WCAG完整通過，仍需人工keyboard／screen-reader smoke。
- `lan_secure_demo`的Mobile／Desktop RWD、keyboard、200% zoom及Auth流程需與本機功能等價，且不得顯示內部profile名稱。
