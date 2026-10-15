import { ADMIN_COOKIES, HANDOFF_COOKIE, adminCookies, internalConfig, sameOriginRequest } from "../../../../lib/server-config";

export const dynamic = "force-dynamic";
const allowedGet = new Set(["auth/me", "audit/security", "games", "reports", "cases"]);
const allowedPost = new Set(["auth/vk/start", "auth/yandex/start", "auth/webauthn/options", "auth/webauthn/verify", "auth/logout", "cases"]);

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const config = internalConfig();
  if (!config) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const path = (await context.params).path.join("/");
  if (new URL(request.url).pathname !== (config.basePath ?? "") + "/v1/admin/" + path)
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const callback = request.method === "GET" && /^auth\/(vk|yandex)\/callback$/.test(path);
  const caseDetail = /^cases\/[0-9a-f-]{36}$/.test(path);
  const caseEvidence = /^cases\/[0-9a-f-]{36}\/evidence(?:\/[0-9a-f-]{36})?$/.test(path);
  const caseCommand = /^cases\/[0-9a-f-]{36}\/commands$/.test(path);
  const userDetail = /^users\/[0-9a-f-]{36}\/restrictions$/.test(path);
  const userCommand = /^users\/[0-9a-f-]{36}\/restrictions\/commands$/.test(path);
  const gameDetail = /^games\/[0-9a-f-]{36}$/.test(path);
  const gameCommand = /^games\/[0-9a-f-]{36}\/moderation\/commands$/.test(path);
  const venueRoute = request.method === "GET" ? /^venues(?:\/(?:duplicates|[0-9a-f-]{36}(?:\/games)?))?$/.test(path) : /^venues(?:\/(?:[0-9a-f-]{36}\/commands|duplicates\/[0-9a-f-]{36}\/dismiss))?$/.test(path);
  if (!(venueRoute || callback || (request.method === "GET" ? allowedGet.has(path) || gameDetail || userDetail || caseDetail || caseEvidence : allowedPost.has(path) || gameCommand || userCommand || caseCommand)))
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!sameOriginRequest(request, config.origin, callback))
    return Response.json({ code: "ADMIN_ORIGIN_REJECTED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const headers = new Headers({ Origin: config.origin, Cookie: adminCookies(request.headers.get("cookie") ?? "") });
  for (const name of ["content-type", "x-csrf-token", "idempotency-key"])
    if (request.headers.has(name)) headers.set(name, request.headers.get(name)!);
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && body.length > 65536) return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  try {
    const url = new URL("/v1/admin/" + path, config.api);
    if (venueRoute && request.method === "GET") url.search = new URL(request.url).search;
    if (callback) {
      const query = new URL(request.url).searchParams;
      for (const name of ["state", "code", "device_id"]) if (query.has(name)) url.searchParams.set(name, query.get(name)!);
    }
    if (request.method === "GET" && (path === "games" || gameDetail || userDetail || path === "cases" || path === "reports" || caseDetail || caseEvidence)) {
      const query = new URL(request.url).searchParams;
      const names = path === "reports" ? ["beforeId", "limit", "reportId"] : path === "cases" || /\/evidence$/.test(path) ? ["beforeId", "limit"] : caseDetail ? ["beforeVersion"] : caseEvidence ? [] : path === "games" ? ["cursor", "limit"] : userDetail ? ["beforeVersion"] : ["historyCursor"];
      for (const [name, value] of query) {
        if (!names.includes(name) || value.length > 256 || query.getAll(name).length !== 1)
          return Response.json({code:"ADMIN_INVALID_REQUEST"},{status:400,headers:{"Cache-Control":"no-store"}});
        url.searchParams.set(name,value);
      }
    }
    const upstream = await fetch(url, { method: request.method, headers, body, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15000) });
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
    for (const cookie of upstream.headers.getSetCookie()) {
      const name = cookie.split("=")[0];
      if (name && ADMIN_COOKIES.includes(name)) responseHeaders.append("Set-Cookie", cookie);
    }
    if (callback) {
      let ticket = null;
      if (upstream.ok) {
        const data = await upstream.json();
        if (typeof data.csrfToken === "string" && typeof data.principalId === "string" && ["active", "pending_mfa"].includes(data.status))
          ticket = { csrfToken: data.csrfToken, principalId: data.principalId, status: data.status };
      }
      responseHeaders.set("Location", config.origin + (config.basePath ?? "") + (ticket ? "/?auth=complete" : "/?auth=failed"));
      responseHeaders.append("Set-Cookie", `${HANDOFF_COOKIE}=${ticket ? encodeURIComponent(JSON.stringify(ticket)) : ""}; Path=/; Max-Age=${ticket ? 600 : 0}; Secure; HttpOnly; SameSite=Strict`);
      return new Response(null, { status: 303, headers: responseHeaders });
    }
    responseHeaders.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    return new Response(upstream.status === 204 ? null : await upstream.text(), { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ code: "ADMIN_UPSTREAM_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
export const GET = proxy;
export const POST = proxy;
