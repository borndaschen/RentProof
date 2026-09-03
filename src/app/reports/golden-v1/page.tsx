import type { Metadata } from "next";
import { ReportDocument } from "@/components/report/report-document";
import { getGoldenReportViewModel } from "@/server/demo/golden-report-view-model";
import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Golden 簽約前報告｜RentProof",
  description: "完全虛構的 RentProof 簽約前確認報告。",
};

export default function GoldenReportPage() {
  const environment = getServerEnvironment();
  return <ReportDocument report={getGoldenReportViewModel(environment.RENTPROOF_RULE_PROFILE)} />;
}
