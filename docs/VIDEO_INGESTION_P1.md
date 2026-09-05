# 影片證據 P1 邊界

狀態：**Secure LAN的使用者入口、Windows FFprobe／FFmpeg adapter、安全Gate、加密frame bundle與分析locator接線已完成**。

RentProof 的影片擴充只接受單一 MP4、最多 50 MiB、30 秒、4K、60 fps。Server 會以固定每 2 秒取一幀、最多 15 幀的規則產生 JPEG derivative，並保留 `artifactId + timestampMs + frameNo` 定位。抽幀輸出必須移除 metadata、重新驗證尺寸／格式／bytes／SHA-256，才可交給既有影像證據流程。

影片中的音訊不會抽取、轉錄或分析；不做臉部辨識，也不得由單幀或影片推斷漏水、結構安全、違法、詐騙或責任。沒有拍到仍是證據不足，不是矛盾。

目前開發機已在 repository 外的 RentProof 私有 runtime 下載 GyanD FFmpeg `9.0.1-essentials_build`。下載來源是 [FFmpeg 官網列出的 Windows build provider](https://ffmpeg.org/download.html)；壓縮檔 SHA-256 `fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9` 已與 [GyanD 發布端 sidecar](https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256) 相符。`approved-runtime.ts` 固定本次 `ffmpeg.exe` 與 `ffprobe.exe` 的完整版本字串及 SHA-256；binary、下載檔與隨附 GPLv3 License 不提交 repository，也不加入全域 PATH。

`PinnedFfmpegRuntimeGate` 要求兩個工具的版本與 SHA-256 完全符合上述設定；缺少、格式錯誤或版本／hash 不符都 fail closed。`createApprovedWindowsFfmpegAdapters({ runtimeRoot })` 只從呼叫端提供、已通過既有 Windows runtime preflight 的 root 組出固定 binary 路徑，不搜尋或依賴 `PATH`。Adapter 會在該 root 的 `cache/video` 建立單次私有工作目錄，限制 probe／extract timeout 與 stdout／stderr、禁止網路 protocol、限制每幀與總輸出大小、移除 metadata，並在成功或失敗後清除來源與 derivative 暫存檔。

Windows packaged desktop process 若由作業系統把 LocalAppData 寫入透明導向 `Packages/<package>/LocalCache/Local`，workspace Gate 只接受相同 logical suffix 的精確 OS mirror；其他 realpath 差異仍 fail closed。檔案操作維持使用 logical runtime path，避免驗證完成後繞過 Windows 的一致虛擬化行為。

實際抽幀使用固定 timestamp plan、單執行緒與 bitexact flags，JPEG 不放大且最長邊最多 3200 px；每一幀會以 Sharp 重新解碼驗證並計算 SHA-256。Secure LAN upload route沿用既有CSRF／Origin／owner與Cloud Processing Notice Gate，將原始MP4與不含base64的受驗frame bundle加密保存；分析載入時重新驗bundle、逐幀雜湊與順序，並把同一影片artifact ID及精確`timestampMs／frameNo`送入strict evidence contract。

依D-104，入口現在回202 processing receipt，背景worker完成受限抽幀後才發布available artifact。瀏覽器透過owner-scoped endpoint查詢進度與取消，polling不延長session；案件刪除會移除相關queue refs，舊lease不能完成。LAN的queue snapshot以PostgreSQL CAS保存；多process／HA整體部署仍未驗收。
