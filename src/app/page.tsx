import { ConversationShell } from "@/components/conversation/conversation-shell";
import { getServerEnvironment } from "@/server/env";
import { createRuntimeStatusProjection } from "@/server/runtime-status";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const runtimeStatus = createRuntimeStatusProjection(getServerEnvironment());
  return <ConversationShell runtimeStatus={runtimeStatus} />;
}
