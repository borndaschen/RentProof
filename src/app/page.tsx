import { ConversationShell } from "@/components/conversation/conversation-shell";
import { RealDemoHome } from "@/components/real-demo/real-demo-home";
import { getServerEnvironment } from "@/server/env";
import { createRuntimeStatusProjection } from "@/server/runtime-status";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const runtimeStatus = createRuntimeStatusProjection(getServerEnvironment());
  return runtimeStatus.dataPolicy === "real_data_enabled" ? (
    <RealDemoHome
      analysisEnabled={
        runtimeStatus.llmMode === "live" && runtimeStatus.projectLimits === "confirmed"
      }
    />
  ) : (
    <ConversationShell runtimeStatus={runtimeStatus} />
  );
}
