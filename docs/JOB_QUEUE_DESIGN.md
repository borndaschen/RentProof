# Bounded 工作佇列設計

- 狀態：P1 Application契約、Windows JSON持久化adapter與governed worker orchestration已實作
- 實作：`src/application/jobs/`、`src/adapters/storage/json-job-queue/`

## 用途與邊界

共用佇列只接受三種allowlisted工作：`contract.ocr`、`evidence.video_frames`與`analysis.pipeline`。它不是可執行任意函式、命令、URL或使用者文字的通用task runner。

Job payload只保存opaque actor／case／artifact IDs、expected revision、priority與type；不放PDF／影片bytes、OCR文字、檔名、prompt、provider output、secret或不必要個資。Worker claim後仍須重新執行owner、policy、Cloud Notice、budget及private storage Gate，不能因工作已入列而視為授權完成。

## Queue契約

- 最多10,000筆records，同時最多2筆running，同一case同時最多1筆。
- Lease固定60秒；worker以opaque lease ID＋worker ID完成或失敗。錯誤lease、過期lease或重播均拒絕。
- 最多3次attempt；retryable failure延後1秒重新入列，超限轉terminal failed。
- Terminal record保留24小時後清除；live queued／running record不為騰出空間而驅逐。
- Idempotency key只保存SHA-256；same key／same binding重用job，same key／different binding回conflict。
- Priority固定`blocking → normal → background`，相同priority依建立時間與job ID決定，不讓LLM或user text自由排序。

## 持久化與重啟恢復

- `PersistentBoundedJobQueue`只依賴application層的`JobQueueStateStore` compare-and-swap port；filesystem、Windows path與atomic replace細節留在adapter。
- 每次enqueue、claim、complete、fail、cancel、delete、case purge與maintenance都以一份帶revision的`rentproof.job-queue.v1` snapshot原子替換。操作只在snapshot落盤後回成功；CAS衝突有限重試，超限fail closed為`JOB_QUEUE_CONTENTION`。
- Windows adapter只寫入validated app-owned runtime run的`state/jobs/job-queue.json`，限制32 MiB，使用同process per-file lock與temporary-file sync＋rename；固定磁碟、canonical path與no-reparse Gate沿用runtime policy。
- Process重新啟動後直接讀取snapshot；running job保留hashed lease。Lease過期會原子requeue，達attempt上限則failed，因此worker crash不會把案件永久卡在running。
- Snapshot採strict schema，並驗證record上限、job ID／idempotency hash唯一性、lease與terminal欄位一致性。JSON損壞、unknown key、重複或不一致狀態一律`JOB_QUEUE_CORRUPT`，不重設空queue也不覆寫原檔。
- Idempotency hash綁定actorRef與opaque key，binding hash再綁priority與完整typed work；不同actor使用相同client key不會互相取得job ID。

## Owner、Policy與刪除Gate

- Queue保存`actorRef`、`caseId`、`expectedRevision`與artifact ref；這些是重新查核的binding，不代表授權或同意仍有效。
- Worker在讀取private artifact與執行stage前，必須呼叫application的typed `JobExecutionGate`，以claim回傳的actor binding重新驗owner、case revision、Policy、Cloud Processing Notice、budget與deletion狀態。任何Gate失敗均不得取資料或呼叫provider，並以typed failure／cancel結束工作。
- `GovernedJobWorker`固定只從三種handler registry claim工作，先呼叫上述Gate，通過後才dispatch；未預期exception只保存`JOB_HANDLER_FAILED`，不把provider body、路徑或secret寫入queue。Lease transition失敗會fail closed，不把工作誤標成功。
- 單筆cancel綁actor、case與expected revision，會立即清除active lease；單筆delete只允許terminal record。案件刪除workflow以owner-validated actor＋case呼叫`purgeCase`，連queued／running／terminal records一起移除並使舊lease失效。
- Queue API刻意不自行查owner repository；應由server/application orchestration先做owner-scoped authorization，再以相同binding呼叫queue。Opaque ID不能代替此Gate。

## OCR與影片整合

- `contract.ocr` worker以owner-scoped artifact port取得掃描PDF bytes，再呼叫`PrepareScannedPdfOcr`。OCR結果仍是需人工確認的candidate，不直接建立Clause／Finding。
- `evidence.video_frames` worker取得MP4 bytes後呼叫`prepareVideoEvidence`；只有pinned FFmpeg runtime、probe、extractor與Sharp verifier全部通過才能完成。
- 工作結果只保存opaque result ref；完整衍生資料由owner-scoped repository／private storage管理。

## Production Gate

Windows JSON adapter與governed worker提供單機、單process部署的落盤、process restart恢復與執行前Gate，不宣稱HA或多process distributed queue。正式營運仍須配置實際handler composition、graceful shutdown、dead-letter人工處理與metrics／alert；若未來改為多Web／worker process，必須換成具跨process transaction／row locking的typed adapter。不得用目前的in-process file lock宣稱跨process互斥。
