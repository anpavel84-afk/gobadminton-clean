import { NextResponse } from "next/server";
import { CURRENT_APPLICATION_VERSION, runtimeBuildGitSha } from "../../lib/releases";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "gobadminton-web",
      timestamp: new Date().toISOString(),
      applicationVersion: CURRENT_APPLICATION_VERSION,
      gitSha: runtimeBuildGitSha(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
