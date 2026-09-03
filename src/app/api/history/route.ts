import { historyErrorResponse, listCurrentActorHistory } from "@/server/history";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const cases = await listCurrentActorHistory(request);
    return Response.json(
      { schemaVersion: "rentproof.case-history.v1", cases },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return historyErrorResponse(error);
  }
}
