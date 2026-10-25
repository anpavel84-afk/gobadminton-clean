import type { NextConfig } from "next";
import path from "node:path";

const pathBuild = process.env.ADMIN_DEV_PATH_BUILD ?? "0";
if (!["0", "1"].includes(pathBuild)) throw new Error("Invalid Admin path build opt-in");
const basePath = pathBuild === "1" ? "/admin" : "";

const config: NextConfig = {
  basePath,
  // nginx owns the query-free /admin -> /admin/ redirect. Avoid a slash loop.
  skipTrailingSlashRedirect: basePath !== "",
  env: { NEXT_PUBLIC_ADMIN_BASE_PATH: basePath },
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Cache-Control", value: "no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    ] }];
  },
};
export default config;
