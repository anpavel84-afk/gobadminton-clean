import { cookies } from "next/headers";
import { HANDOFF_COOKIE, internalConfig, adminRequestOrigin, adminRequestPath } from "../../../lib/server-config";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const config = internalConfig();
  if (!config) return new Response(null, { status: 404 });
  if (!adminRequestPath(request, config, "/internal/auth-ticket")) return new Response(null, { status: 404 });
  if (!adminRequestOrigin(request, config)) return new Response(null, { status: 403 });
  const raw = (await cookies()).get(HANDOFF_COOKIE)?.value;
  const headers = { "Cache-Control": "no-store", "Set-Cookie": `${HANDOFF_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict` };
  try {
    const ticket = JSON.parse(decodeURIComponent(raw ?? ""));
    if (typeof ticket.csrfToken !== "string" || typeof ticket.principalId !== "string" || !["active", "pending_mfa"].includes(ticket.status)) throw new Error();
    return Response.json(ticket, { headers });
  } catch { return new Response(null, { status: 401, headers }); }
}
