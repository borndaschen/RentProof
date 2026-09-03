import { getCurrentActorCaseHistory, historyErrorResponse } from "@/server/history";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  try {
    const { caseId } = await context.params;
    const rentalCase = await getCurrentActorCaseHistory(request, caseId);
    return Response.json(
      { schemaVersion: "rentproof.case-history-detail.v1", case: rentalCase },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return historyErrorResponse(error);
  }
}
