"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { FollowUpResultViewSchema } from "@/application/follow-ups/contracts";
import {
  OfficialRuleIdSchema,
  OfficialRuleProfileSchema,
  isCompleteOfficialRuleProfile,
  officialRuleIdsForProfile,
} from "@/domain/official-rules";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/u);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ClaimIdSchema = z.enum([
  "claim-rent",
  "claim-washing-machine",
  "claim-electricity-rate",
  "claim-rent-subsidy",
]);
const UploadReceiptSchema = z
  .object({
    schemaVersion: z.literal("rentproof.synthetic-upload-receipt.v1"),
    receiptId: OpaqueIdSchema,
    kind: z.enum(["listing", "viewing", "contract", "follow_up"]),
    originalSha256: Sha256Schema,
    derivativeSha256: Sha256Schema.nullable(),
    media: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("image"),
          mime: z.enum(["image/jpeg", "image/png"]),
          width: z.number().int().positive().max(3_200),
          height: z.number().int().positive().max(3_200),
        })
        .strict(),
      z
        .object({
          type: z.literal("pdf"),
          mime: z.literal("application/pdf"),
          pageCount: z.number().int().min(1).max(30),
          characterCount: z.number().int().min(1).max(300_000),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      (receipt.media.type === "image" && receipt.derivativeSha256 === null) ||
      (receipt.media.type === "pdf" && receipt.derivativeSha256 !== null) ||
      (receipt.media.type === "pdf") !== (receipt.kind === "contract")
    ) {
      context.addIssue({ code: "custom", message: "UPLOAD_RECEIPT_RELATION_INVALID" });
    }
  });
const FindingSummarySchema = z
  .object({
    claimId: ClaimIdSchema,
    status: z.enum(["supported", "contradicted", "insufficient_evidence"]),
    sourceRefs: z.array(z.string().min(1).max(160)).min(1).max(8),
  })
  .strict();
const FixtureAnalysisSnapshotSchema = z
  .object({
    schemaVersion: z.literal("rentproof.fixture-analysis-snapshot.v1"),
    snapshotId: OpaqueIdSchema,
    caseVersion: z.literal("golden-v1"),
    manifestHash: Sha256Schema,
    executionMode: z.literal("fixture"),
    providerCalled: z.literal(false),
    findings: z.array(FindingSummarySchema),
    nextActions: z.array(z.string().min(1).max(240)).min(1).max(10),
    reportHref: z.literal("/reports/golden-v1"),
  })
  .strict();
const LiveStageRunSchema = z
  .object({
    stage: z.enum([
      "listing.extract",
      "evidence.extract",
      "contract.extract",
      "interaction.extract",
    ]),
    status: z.literal("succeeded"),
    outputHash: Sha256Schema,
    providerRequestId: z.string().min(1).max(128),
    providerAttempts: z.number().int().min(1).max(16),
    requestedModel: z.literal("gpt-5.6-terra"),
    resolvedModel: z.string().min(1).max(128),
    reasoningEffort: z.literal("medium"),
    requestedServiceTier: z.literal("default"),
    resolvedServiceTier: z.string().min(1).max(64).nullable(),
    promptVersion: z.string().min(1).max(64),
    schemaVersion: z.literal("rentproof.terra-analysis.v2"),
    usage: z.discriminatedUnion("known", [
      z
        .object({
          known: z.literal(true),
          inputTokens: z.number().int().nonnegative(),
          cachedInputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
          reasoningTokens: z.number().int().nonnegative(),
          totalTokens: z.number().int().nonnegative(),
        })
        .strict(),
      z.object({ known: z.literal(false) }).strict(),
    ]),
  })
  .strict();
const LiveAnalysisSnapshotSchema = z
  .object({
    schemaVersion: z.literal("rentproof.live-analysis-snapshot.v1"),
    snapshotId: OpaqueIdSchema,
    caseVersion: z.literal("golden-v1"),
    manifestHash: Sha256Schema,
    executionMode: z.literal("live"),
    providerCalled: z.literal(true),
    ruleProfile: OfficialRuleProfileSchema,
    stageRuns: z.array(LiveStageRunSchema).length(4),
    budget: z
      .object({
        providerAttempts: z.number().int().min(1).max(16),
        inputTokens: z.number().int().nonnegative().max(500_000),
        outputAndReasoningTokens: z.number().int().nonnegative().max(50_000),
        cachedInputTokens: z.number().int().nonnegative().max(500_000),
        engineeringAlertReached: z.boolean(),
        usageKnown: z.boolean(),
      })
      .strict(),
    configurationWarnings: z.array(z.literal("OPENAI_PROJECT_LIMITS_UNVERIFIED")).max(1),
    findings: z.array(FindingSummarySchema),
    ruleChecks: z
      .array(
        z
          .object({
            ruleId: OfficialRuleIdSchema,
            result: z.enum(["no_difference_found", "possible_difference", "missing_information"]),
            reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
            sourceRefs: z.array(OpaqueIdSchema).min(1).max(8),
          })
          .strict(),
      )
      .min(6)
      .max(10),
    fraudSignals: z
      .array(
        z
          .object({
            signalId: z.literal("FRS-001"),
            status: z.enum([
              "detected",
              "not_detected_in_provided_data",
              "insufficient_information",
            ]),
            action: z.enum(["review", "stop_and_verify"]),
            reasonCode: z.enum([
              "FRS_001_PAYMENT_BEFORE_VIEWING",
              "FRS_001_PAYMENT_NOT_BEFORE_VIEWING",
              "FRS_001_PAYMENT_EVIDENCE_MISSING",
              "FRS_001_TIMELINE_INCOMPLETE",
            ]),
            sourceRefs: z.array(OpaqueIdSchema).max(8),
          })
          .strict(),
      )
      .length(1),
    nextActions: z.array(z.string().min(1).max(240)).min(1).max(10),
    reportHref: z.literal("/reports/golden-v1"),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = snapshot.ruleChecks.map((check) => check.ruleId);
    if (
      !isCompleteOfficialRuleProfile(ids) ||
      JSON.stringify([...ids].sort()) !==
        JSON.stringify([...officialRuleIdsForProfile(snapshot.ruleProfile)].sort())
    ) {
      context.addIssue({ code: "custom", message: "LIVE_RULE_PROFILE_INVALID" });
    }
  });
const AnalysisSnapshotSchema = z.discriminatedUnion("executionMode", [
  FixtureAnalysisSnapshotSchema,
  LiveAnalysisSnapshotSchema,
]);

type UploadReceipt = z.infer<typeof UploadReceiptSchema>;
type ArtifactId = (typeof GOLDEN_ARTIFACTS)[number]["artifactId"];
type UploadState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; receipt: UploadReceipt }
  | { status: "failure" };
type AnalysisState =
  | { status: "idle" | "pending" | "failure" }
  | { status: "success"; snapshot: z.infer<typeof AnalysisSnapshotSchema> };
type FollowUpState =
  | { status: "idle" | "pending" | "failure" }
  | { status: "success"; result: z.infer<typeof FollowUpResultViewSchema> };

const claimLabels: Readonly<Record<z.infer<typeof ClaimIdSchema>, string>> = {
  "claim-rent": "月租金額",
  "claim-washing-machine": "洗衣機承諾",
  "claim-electricity-rate": "電費單價",
  "claim-rent-subsidy": "租金補貼承諾",
};

const GOLDEN_ARTIFACTS = [
  {
    artifactId: "listing-synthetic-listing-png",
    label: "虛構租屋廣告 PNG",
    filename: "synthetic-listing.png",
    mime: "image/png",
  },
  {
    artifactId: "viewing-view-10-jpg",
    label: "虛構看屋照片 JPG",
    filename: "view-10.jpg",
    mime: "image/jpeg",
  },
  {
    artifactId: "contract-synthetic-lease-pdf",
    label: "虛構租約 PDF",
    filename: "synthetic-lease.pdf",
    mime: "application/pdf",
  },
  {
    artifactId: "follow-up-wall-close-up-png",
    label: "虛構牆面補拍 PNG",
    filename: "wall-close-up.png",
    mime: "image/png",
  },
] as const;

const INITIAL_STATE: Record<ArtifactId, UploadState> = {
  "listing-synthetic-listing-png": { status: "idle" },
  "viewing-view-10-jpg": { status: "idle" },
  "contract-synthetic-lease-pdf": { status: "idle" },
  "follow-up-wall-close-up-png": { status: "idle" },
};

export function GoldenUploadPanel() {
  const [states, setStates] = useState<Record<ArtifactId, UploadState>>(INITIAL_STATE);
  const [busyArtifactId, setBusyArtifactId] = useState<ArtifactId | null>(null);
  const [analysisState, setAnalysisState] = useState<AnalysisState>({ status: "idle" });
  const [followUpState, setFollowUpState] = useState<FollowUpState>({ status: "idle" });
  const busyRef = useRef(false);

  async function loadArtifact(artifact: (typeof GOLDEN_ARTIFACTS)[number]) {
    if (
      busyRef.current ||
      busyArtifactId !== null ||
      states[artifact.artifactId].status === "success"
    ) {
      return;
    }
    busyRef.current = true;
    setBusyArtifactId(artifact.artifactId);
    updateState(artifact.artifactId, { status: "pending" });
    try {
      const sourceResponse = await fetch(
        `/api/demo/golden-v1/artifacts/${encodeURIComponent(artifact.artifactId)}`,
        { method: "GET", cache: "no-store", credentials: "same-origin" },
      );
      if (!sourceResponse.ok || sourceResponse.headers.get("content-type") !== artifact.mime) {
        throw new Error("GOLDEN_SOURCE_INVALID");
      }
      const bytes = new Uint8Array(await sourceResponse.arrayBuffer());
      const uploadResponse = await fetch("/api/cases/golden-v1/uploads", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-RentProof-Demo-Artifact-Id": artifact.artifactId,
          "X-RentProof-Upload-Filename": artifact.filename,
          "X-RentProof-Upload-Mime": artifact.mime,
          "Idempotency-Key": crypto.randomUUID(),
          "X-RentProof-CSRF": "rentproof-synthetic-upload-v1",
        },
        body: bytes,
      });
      const payload: unknown = await uploadResponse.json();
      const receipt = UploadReceiptSchema.safeParse(payload);
      if (!uploadResponse.ok || !receipt.success || receipt.data.kind !== expectedKind(artifact)) {
        throw new Error("GOLDEN_UPLOAD_INVALID");
      }
      updateState(artifact.artifactId, { status: "success", receipt: receipt.data });
      if (artifact.artifactId !== "follow-up-wall-close-up-png") {
        setAnalysisState({ status: "idle" });
        setFollowUpState({ status: "idle" });
      }
    } catch {
      updateState(artifact.artifactId, { status: "failure" });
    } finally {
      busyRef.current = false;
      setBusyArtifactId(null);
    }
  }

  function updateState(artifactId: ArtifactId, state: UploadState) {
    setStates((current) => ({ ...current, [artifactId]: state }));
  }

  async function runFixtureAnalysis() {
    if (analysisState.status === "pending" || !requiredUploadsReady(states)) return;
    setAnalysisState({ status: "pending" });
    const receiptIds = GOLDEN_ARTIFACTS.flatMap((artifact) => {
      const state = states[artifact.artifactId];
      return state.status === "success" ? [state.receipt.receiptId] : [];
    });
    try {
      const response = await fetch("/api/cases/golden-v1/analysis-runs", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-RentProof-CSRF": "rentproof-synthetic-analysis-v1",
        },
        body: JSON.stringify({ receiptIds }),
      });
      const parsed = AnalysisSnapshotSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("FIXTURE_ANALYSIS_INVALID");
      setAnalysisState({ status: "success", snapshot: parsed.data });
      setFollowUpState({ status: "idle" });
    } catch {
      setAnalysisState({ status: "failure" });
    }
  }

  async function applyWallFollowUp() {
    const upload = states["follow-up-wall-close-up-png"];
    if (
      analysisState.status !== "success" ||
      upload.status !== "success" ||
      followUpState.status === "pending"
    ) {
      return;
    }
    setFollowUpState({ status: "pending" });
    try {
      const response = await fetch(
        "/api/cases/golden-v1/findings/finding_wall_follow_up_00001/follow-ups",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            "X-RentProof-CSRF": "rentproof-synthetic-follow-up-v1",
          },
          body: JSON.stringify({ receiptId: upload.receipt.receiptId, expectedRevision: 0 }),
        },
      );
      const parsed = FollowUpResultViewSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("FOLLOW_UP_RESULT_INVALID");
      setFollowUpState({ status: "success", result: parsed.data });
    } catch {
      setFollowUpState({ status: "failure" });
    }
  }

  return (
    <section className="evidence-card" aria-labelledby="golden-upload-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">虛構範例資料</p>
          <h2 id="golden-upload-title">載入已封存的虛構證據</h2>
        </div>
        <span className="status-pill">固定 4 項</span>
      </div>
      <p>這個展示只接受下列已封存的虛構資料，不提供真實檔案、拖放、網址或自由上傳入口。</p>
      <ul className="workspace-list">
        {GOLDEN_ARTIFACTS.map((artifact) => {
          const state = states[artifact.artifactId];
          const isPending = state.status === "pending";
          const disabled = busyArtifactId !== null || state.status === "success";
          return (
            <li className="workspace-item" key={artifact.artifactId}>
              <strong>{artifact.label}</strong>
              <UploadStatus state={state} />
              <div className="card-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={disabled}
                  onClick={() => loadArtifact(artifact)}
                >
                  {state.status === "success"
                    ? "已安全載入"
                    : isPending
                      ? "驗證中"
                      : state.status === "failure"
                        ? "重新載入"
                        : "載入此虛構素材"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="card-actions">
        <button
          className="primary-button"
          type="button"
          onClick={runFixtureAnalysis}
          disabled={!requiredUploadsReady(states) || analysisState.status === "pending"}
        >
          {analysisState.status === "pending" ? "分析中" : "分析已載入素材"}
        </button>
      </div>
      {analysisState.status === "failure" ? (
        <p className="composer-error" role="alert">
          分析未完成；既有案件與證據狀態沒有變更。
        </p>
      ) : null}
      {analysisState.status === "success" ? (
        <div className="fixture-analysis-result" role="region" aria-label="範例分析結果">
          <strong>
            {analysisState.snapshot.executionMode === "live"
              ? "已完成 OpenAI 雲端分析"
              : "已載入預先整理結果"}
          </strong>
          <ul>
            {analysisState.snapshot.findings.map((finding) => (
              <li key={finding.claimId}>
                {claimLabels[finding.claimId]}：{findingStatusLabel(finding.status)}
              </li>
            ))}
          </ul>
          <a className="secondary-button" href={analysisState.snapshot.reportHref}>
            查看完整簽約前報告
          </a>
          {states["follow-up-wall-close-up-png"].status === "success" ? (
            <button
              className="primary-button"
              type="button"
              onClick={applyWallFollowUp}
              disabled={followUpState.status === "pending" || followUpState.status === "success"}
            >
              {followUpState.status === "pending"
                ? "更新中"
                : followUpState.status === "success"
                  ? "補拍已套用"
                  : "套用牆面補拍"}
            </button>
          ) : null}
        </div>
      ) : null}
      {followUpState.status === "failure" ? (
        <p className="composer-error" role="alert">
          補拍更新未完成；原有結果與判斷維持不變。
        </p>
      ) : null}
      {followUpState.status === "success" ? (
        <div className="fixture-analysis-result" role="region" aria-label="牆面補拍更新結果">
          <strong>已完成局部更新</strong>
          <p>{followUpState.result.wallObservation.description}</p>
          <ul>
            {followUpState.result.wallFinding.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
          <div className="card-actions">
            {followUpState.result.sources.map((source) => (
              <a className="secondary-button" href={source.href} key={source.relation}>
                {source.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}
      <div className="warning-note" role="note">
        僅限虛構範例資料。啟用雲端分析時，內容會傳送至
        OpenAI；不得用於真實租約、個人資料或正式證據。
      </div>
    </section>
  );
}

function requiredUploadsReady(states: Record<ArtifactId, UploadState>): boolean {
  const required: readonly ArtifactId[] = [
    "listing-synthetic-listing-png",
    "viewing-view-10-jpg",
    "contract-synthetic-lease-pdf",
  ];
  return required.every((artifactId) => states[artifactId].status === "success");
}

function findingStatusLabel(status: "supported" | "contradicted" | "insufficient_evidence") {
  if (status === "supported") return "支持";
  if (status === "contradicted") return "矛盾";
  return "證據不足";
}

function UploadStatus({ state }: { state: UploadState }) {
  if (state.status === "pending") {
    return <span role="status">正在取得檔案並確認內容完整。</span>;
  }
  if (state.status === "failure") {
    return <span role="alert">載入失敗；沒有加入任何資料。</span>;
  }
  if (state.status === "success") {
    return state.receipt.media.type === "image" ? (
      <span role="status">
        {kindLabel(state.receipt.kind)}・{state.receipt.media.width} × {state.receipt.media.height}{" "}
        px
      </span>
    ) : (
      <span role="status">
        契約・{state.receipt.media.pageCount} 頁・{state.receipt.media.characterCount} 字元
      </span>
    );
  }
  return <span>尚未載入</span>;
}

function expectedKind(artifact: (typeof GOLDEN_ARTIFACTS)[number]): UploadReceipt["kind"] {
  if (artifact.artifactId.startsWith("listing-")) return "listing";
  if (artifact.artifactId.startsWith("viewing-")) return "viewing";
  if (artifact.artifactId.startsWith("contract-")) return "contract";
  return "follow_up";
}

function kindLabel(kind: UploadReceipt["kind"]): string {
  if (kind === "listing") return "廣告";
  if (kind === "viewing") return "看屋證據";
  if (kind === "follow_up") return "補拍證據";
  return "契約";
}
