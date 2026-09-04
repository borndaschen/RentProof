import { NextResponse, type NextRequest } from "next/server";
import { getServerEnvironment } from "@/server/env";
import {
  sanitizedDirectRequestHeaders,
  validateGlobalNetworkBoundary,
} from "@/server/network/request-boundary";

export default function proxy(request: NextRequest) {
  let environment;
  try {
    environment = getServerEnvironment();
  } catch {
    return networkBoundaryError(503);
  }
  const boundary = validateGlobalNetworkBoundary(request.headers, environment);
  if (!boundary.ok) return networkBoundaryError(400);
  const trustedSourceIp =
    environment.RENTPROOF_DEPLOYMENT_PROFILE === "lan_secure_demo" &&
    environment.RENTPROOF_INTERNAL_PROXY_TOKEN !== undefined &&
    request.headers.get("x-rentproof-network-verified") ===
      environment.RENTPROOF_INTERNAL_PROXY_TOKEN
      ? request.headers.get("x-forwarded-for")
      : null;
  const sanitizedHeaders = sanitizedDirectRequestHeaders(request.headers);
  if (
    environment.RENTPROOF_DEPLOYMENT_PROFILE === "lan_secure_demo" &&
    environment.RENTPROOF_INTERNAL_PROXY_TOKEN
  ) {
    sanitizedHeaders.set(
      "x-rentproof-network-verified",
      environment.RENTPROOF_INTERNAL_PROXY_TOKEN,
    );
    if (trustedSourceIp !== null) sanitizedHeaders.set("x-rentproof-source-ip", trustedSourceIp);
  }
  return NextResponse.next({ request: { headers: sanitizedHeaders } });
}

export const config = {
  matcher: ["/:path*"],
};

function networkBoundaryError(status: 400 | 503): NextResponse {
  return NextResponse.json(
    { error: "REQUEST_NETWORK_BOUNDARY_REJECTED" },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
