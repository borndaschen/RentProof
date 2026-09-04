import type { NextConfig } from "next";

const isDevelopment = process.env["NODE_ENV"] === "development";
const publicOrigin = process.env["RENTPROOF_PUBLIC_ORIGIN"] ?? "http://127.0.0.1:3000";
const isSecureLanDemo = process.env["RENTPROOF_DEPLOYMENT_PROFILE"] === "lan_secure_demo";
const websocketOrigin = publicOrigin.replace(/^http/u, "ws");
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${isDevelopment ? ` ${websocketOrigin}` : ""}`,
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "media-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  enablePrerenderSourceMaps: false,
  experimental: {
    serverSourceMaps: false,
  },
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Cache-Control", value: "private, no-store" },
          ...(isSecureLanDemo
            ? [{ key: "Strict-Transport-Security", value: "max-age=86400" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
