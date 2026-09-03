export function historyErrorResponse(error: unknown): Response {
  const code = errorCode(error);
  const status = statusFor(code);
  return Response.json(
    {
      error: {
        code,
        message: messageFor(code),
      },
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    const allowed = new Set([
      "HISTORY_AUTHENTICATION_REQUIRED",
      "HISTORY_ACCOUNT_REQUIRED",
      "HISTORY_NOT_FOUND_OR_FORBIDDEN",
      "HISTORY_FEATURE_DISABLED",
      "HISTORY_DATABASE_UNCONFIGURED",
    ]);
    if (allowed.has(error.code)) return error.code;
  }
  return "HISTORY_UNAVAILABLE";
}

function statusFor(code: string): number {
  if (code === "HISTORY_AUTHENTICATION_REQUIRED") return 401;
  if (code === "HISTORY_ACCOUNT_REQUIRED") return 403;
  if (code === "HISTORY_NOT_FOUND_OR_FORBIDDEN" || code === "HISTORY_FEATURE_DISABLED") return 404;
  return 503;
}

function messageFor(code: string): string {
  if (code === "HISTORY_AUTHENTICATION_REQUIRED") return "請先登入後再查詢歷史案件。";
  if (code === "HISTORY_ACCOUNT_REQUIRED") return "訪客案件不會出現在歷史紀錄。";
  if (code === "HISTORY_NOT_FOUND_OR_FORBIDDEN") return "找不到案件，或目前帳戶無權存取。";
  if (code === "HISTORY_FEATURE_DISABLED") return "此 Demo 模式未開放帳戶歷史。";
  return "帳戶歷史目前無法使用，請檢查 Demo 的帳戶與 PostgreSQL 設定。";
}
