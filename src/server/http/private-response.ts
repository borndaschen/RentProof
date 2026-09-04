import "server-only";

export function privateNoStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
}
