import type { CaseHistorySummary } from "@/application/history";

export function formatHistoryTimestamp(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export function historyStatusLabel(status: CaseHistorySummary["status"]): string {
  if (status === "draft") return "準備資料中";
  if (status === "analyzing") return "正在整理";
  if (status === "needs_attention") return "有項目待確認";
  return "可查看結果";
}
