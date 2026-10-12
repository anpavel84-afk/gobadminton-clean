import type { NextConfig } from "next";
import path from "node:path";

function apiRewriteDestination(): string | null {
  const configured =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? null;
  if (!configured) return null;
  return configured.replace(/\/$/, "") + "/v1/:path*";
}

const apiDestination = apiRewriteDestination();

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
  async rewrites() {
    if (!apiDestination) return [];
    return [
      {
        source: "/v1/:path*",
        destination: apiDestination,
      },
    ];
  },
};

export default nextConfig;
