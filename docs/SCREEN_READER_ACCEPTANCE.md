# Screen Reader 人工驗收

- 狀態：待人工執行
- 目標環境：Windows Narrator＋Chromium，Desktop與200%縮放各一輪

## 前置條件

- 使用Production Build與Fixture資料，不使用真實租約或OpenAI Live。
- 只以鍵盤操作；測試者不得依賴滑鼠或畫面位置。
- 記錄日期、Windows／Chromium／Narrator版本、viewport與每項結果，不記錄案件內容。

## 驗收步驟

1. 啟動Narrator，從首頁依閱讀順序巡覽標題、導覽、對話訊息與案件卡。
2. 使用Tab／Shift+Tab完成案件名稱、同意勾選與建立案件；確認焦點可見且朗讀名稱、角色與狀態。
3. 開啟四區workspace tabs，以方向鍵切換並確認選取狀態與panel關係。
4. 開啟／關閉Dialog、Accordion及其他Radix元件，確認focus trap、Escape關閉與focus restore。
5. 觸發validation、上傳錯誤、資料不足與確認卡，確認錯誤不只靠顏色且動態訊息會被朗讀一次。
6. 將瀏覽器縮放設為200%，重做主要流程；不得水平頁面溢位或遮住操作。
7. 開啟列印預覽，確認證據區與來源保留、互動控制不列印。

## 通過條件

- 所有互動均可由鍵盤完成，沒有keyboard trap。
- 每個control、region、status與error具有可理解的accessible name／role／state。
- 閱讀順序與視覺順序一致；focus不會遺失或跳到背景。
- 結果語意可由文字辨識，不依賴顏色；政策持續朗讀為DRAFT。

完成前不得把axe／Playwright結果寫成screen reader人工驗收通過。
