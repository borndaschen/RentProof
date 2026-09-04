# 租金補貼預檢法律、隱私與規則治理審閱紀錄

- 審閱日期：2026-09-04（Asia/Taipei）
- 範圍：115年度租金補貼申請條件預檢
- 審閱性質：工程／產品內部審閱，不是台灣律師法律意見
- 結論：工程／產品內部控制已完成本次文件化檢查；這不是法律合規通過或外部專業簽核，正式對外服務仍需營運者資料與台灣法律／隱私專業審閱

## 1. 官方依據

- 內政部不動產資訊平台115年度申請條件、問與答、應檢附文件、專區及官方資格試算頁。
- 全國法規資料庫《個人資料保護法》及《個人資料保護法施行細則》。2026-09-04查核的個資法頁面顯示114-11-11部分修正條文施行日未定，因此正式發布前必須重新確認當時已生效版本，不得把未生效文字當成現行義務。

來源URL、快照bytes、SHA-256與驗證字串見[`rules/snapshots/2026-09-04/manifest.json`](../rules/snapshots/2026-09-04/manifest.json)。完整HTML屬本機受控快照，不在公開repository散布。

## 2. 審閱矩陣

| 主題               | 結果                    | 已有控制                                                                                   | 正式上線前要求                                                               |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 政府資格誤認       | 內部控制已檢查          | 名稱固定為「申請條件預檢」；結果只用初步相符／有待確認／資料不足；持續顯示主管機關審查聲明 | 維持禁止「核定、保證符合、官方認證」措辭；由外部專業審閱對外文案             |
| 特定目的與最小化   | 內部控制已檢查          | 只收縣市、enum／boolean、自我確認所得級距及月租；不收姓名、身分證、精確地址或證明文件      | 若新增金額加碼或弱勢類別，先做新的必要性與第6條敏感資料審閱                  |
| 告知義務           | 部分通過                | 頁面先顯示用途、非官方認定及不應提供的資料；隱私草案已列補貼預檢資料類別                   | 營運者名稱、聯絡方式、利用地區與權利申請管道尚未填妥                         |
| 處理依據與目的限制 | 部分通過                | Stateless endpoint不寫案件、資料庫、browser storage、analytics或OpenAI；只回傳當次結果     | 正式營運者須由台灣法律專業確認第19條適用依據與告知文字                       |
| 當事人權利／刪除   | 目前stateless控制已檢查 | 預檢答案不持久化；response為private/no-store                                               | 若未來保存到案件，須接入owner scope、查閱更正、刪除與既有retention workflow  |
| 資料安全           | 內部控制已檢查          | 4 KiB bounded strict JSON、Zod、exact Host／Origin、forwarded-header拒絕、no-store、無LLM  | 正式環境仍受整體Production TLS、logging、incident response與安全維護Gate約束 |
| 第三方／跨境       | 目前功能未觸發          | 預檢不呼叫OpenAI或其他provider                                                             | 新增provider前更新processor、地區、契約與告知審閱                            |
| 規則來源           | 內部控制已檢查          | 官方HTTPS來源、本機快照、manifest、SHA-256、sentinel、31日freshness fail-closed            | 每次公開release及hash異動後人工複核                                          |
| 年度更新           | 內部控制已檢查          | 115規則固定年度；future scaffold禁止複製舊threshold／rule並預設productionReady=false       | 新年度須取得新公告、重建來源與完整回歸，禁止跨年fallback                     |

## 3. 規則治理簽核

每次變更需留下四種角色／證據；單人開發時可由同一工程人員完成前三項，但「獨立法律／隱私審閱」不得自行簽成通過：

1. 來源取得者：URL、取得時間、bytes、content type、SHA-256及拒絕頁檢查。
2. 規則實作者：逐欄對照官方原文、邊界值、unknown與例外行為。
3. 測試審閱者：schema、threshold、跨年度、source mismatch、freshness與禁止措辭。
4. 獨立法律／隱私審閱者：適用法、生效版本、告知、處理依據、敏感資料及對外文案。

只有四項都有具名日期與證據後，才可另作決策把`production_ready`改為`true`。目前第4項尚未完成，因此維持DRAFT。

## 4. 定期查核與年度更新

```powershell
pnpm subsidy:sources:check
pnpm subsidy:sources:check -- --live
pnpm subsidy:year:scaffold -- --roc-year 116 --gregorian-year 2027
```

- Offline check驗證本機快照、manifest及31日freshness。
- Live check只讀取固定官方URL，不寫檔；HTTP、MIME、大小、sentinel或hash不同即失敗並要求人工審閱。
- 年度scaffold使用exclusive create，不覆寫既有草案；新檔沒有來源、threshold或rules，不能從115年自動帶值。
- 查核成功不等於規則內容自動核准；更新verified date、hash或規則值仍須人工比較與DEVLOG紀錄。
- 定期執行不得依賴ChatGPT／Codex task heartbeat；由正式部署環境的OS／CI scheduler以最小權限呼叫上述指令，並把失敗送往營運告警管道。Repository不保存特定雲端排程器credential。
