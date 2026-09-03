import { notFound } from "next/navigation";
import { AuthPanel } from "@/components/auth/auth-panel";
import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export default function AuthPage() {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_AUTH_MODE !== "self_hosted" ||
    !["local_development", "lan_secure_demo"].includes(environment.RENTPROOF_DEPLOYMENT_PROFILE)
  ) {
    notFound();
  }
  return <AuthPanel />;
}
