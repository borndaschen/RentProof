import { notFound } from "next/navigation";
import { AuthPanel } from "@/components/auth/auth-panel";
import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export default function AuthPage() {
  const environment = getServerEnvironment();
  if (
    environment.RENTPROOF_AUTH_MODE !== "self_hosted" ||
    environment.RENTPROOF_DEPLOYMENT_PROFILE !== "local_development"
  ) {
    notFound();
  }
  return <AuthPanel />;
}
