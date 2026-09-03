import { getServerEnvironment } from "@/server/env";
import { createRuntimeStatusProjection } from "@/server/runtime-status";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(createRuntimeStatusProjection(getServerEnvironment()), {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
