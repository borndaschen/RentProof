import { notFound } from "next/navigation";
import { HistoryDetailClientPage } from "@/components/history/history-detail-client-page";
import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "local_development" ||
    environment.RENTPROOF_AUTH_MODE !== "self_hosted"
  )
    notFound();
  const { caseId } = await params;
  return <HistoryDetailClientPage caseId={caseId} />;
}
