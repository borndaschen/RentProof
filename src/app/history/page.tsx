import { notFound } from "next/navigation";
import { HistoryClientPage } from "@/components/history/history-client-page";
import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const environment = getServerEnvironment();
  if (
    !["local_development", "lan_secure_demo"].includes(environment.RENTPROOF_DEPLOYMENT_PROFILE) ||
    environment.RENTPROOF_AUTH_MODE !== "self_hosted"
  )
    notFound();
  return <HistoryClientPage />;
}
