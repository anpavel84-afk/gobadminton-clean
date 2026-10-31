import { ADMIN_COOKIES, HANDOFF_COOKIE, adminCookies, internalConfig, adminRequestOrigin, adminRequestPath } from "../../../../lib/server-config";

export const dynamic = "force-dynamic";
const allowedGet = new Set(["auth/me", "audit/security", "games", "reports", "cases"]);
const allowedPost = new Set(["auth/vk/start", "auth/yandex/start", "auth/webauthn/options", "auth/webauthn/verify", "auth/logout", "cases"]);
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const galleryMeta = [
  "x-gallery-credit-kind",
  "x-gallery-credit-text",
  "x-gallery-credit-url",
  "x-gallery-source-url",
  "x-gallery-source-author",
  "x-gallery-permission-basis",
  "x-gallery-source-fingerprint",
] as const;

function galleryRoute(method: string, path: string): { kind: "get" | "upload" | "replace" | "json"; binary: boolean } | null {
  if (new RegExp("^venues/" + uuid + "/gallery$").test(path)) {
    if (method === "GET") return { kind: "get", binary: false };
    if (method === "POST") return { kind: "upload", binary: true };
    return null;
  }
  if (new RegExp("^venues/" + uuid + "/gallery/reorder$").test(path)) {
    return method === "POST" ? { kind: "json", binary: false } : null;
  }
  if (new RegExp("^venues/" + uuid + "/gallery/" + uuid + "$").test(path)) {
    if (method === "PUT") return { kind: "replace", binary: true };
    if (method === "DELETE") return { kind: "json", binary: false };
    return null;
  }
  if (new RegExp("^venues/" + uuid + "/gallery/" + uuid + "/main$").test(path)) {
    return method === "POST" ? { kind: "json", binary: false } : null;
  }
  return null;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const config = internalConfig();
  if (!config) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const path = (await context.params).path.join("/");
  if (!adminRequestPath(request, config, "/v1/admin/" + path))
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const cover = new RegExp("^venues/" + uuid + "/cover$").test(path);
  const coverAccess = new RegExp("^venues/" + uuid + "/cover/access$").test(path);
  const coverRoute = (request.method === "GET" && (cover || coverAccess)) || (cover && ["PUT", "DELETE"].includes(request.method));
  const gallery = galleryRoute(request.method, path);
  if (!["GET", "POST"].includes(request.method) && !coverRoute && !gallery)
    return new Response(null, {status:404});
  if ((coverRoute || gallery) && new URL(request.url).search) return new Response(null,{status:400});
  const callback = request.method === "GET" && /^auth\/(vk|yandex)\/callback$/.test(path);
  const caseDetail = /^cases\/[0-9a-f-]{36}$/.test(path);
  const caseEvidence = /^cases\/[0-9a-f-]{36}\/evidence(?:\/[0-9a-f-]{36})?$/.test(path);
  const caseCommand = /^cases\/[0-9a-f-]{36}\/commands$/.test(path);
  const userDetail = /^users\/[0-9a-f-]{36}\/restrictions$/.test(path);
  const userCommand = /^users\/[0-9a-f-]{36}\/restrictions\/commands$/.test(path);
  const gameDetail = /^games\/[0-9a-f-]{36}$/.test(path);
  const gameCommand = /^games\/[0-9a-f-]{36}\/moderation\/commands$/.test(path);
  const venueRoute = request.method === "GET" ? /^venues(?:\/(?:duplicates|[0-9a-f-]{36}(?:\/games)?))?$/.test(path) : /^venues(?:\/(?:[0-9a-f-]{36}\/commands|duplicates\/[0-9a-f-]{36}\/dismiss))?$/.test(path);
  if (!(coverRoute || gallery || venueRoute || callback || (request.method === "GET" ? allowedGet.has(path) || gameDetail || userDetail || caseDetail || caseEvidence : allowedPost.has(path) || gameCommand || userCommand || caseCommand)))
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!adminRequestOrigin(request, config, callback))
    return Response.json({ code: "ADMIN_ORIGIN_REJECTED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const headers = new Headers({ Origin: config.origin, Cookie: adminCookies(request.headers.get("cookie") ?? "") });
  const forward = [
    "content-type", "x-csrf-token", "idempotency-key",
    ...((coverRoute || gallery) ? ["x-venue-version"] : []),
    ...(gallery && (gallery.kind === "upload" || gallery.kind === "replace") ? galleryMeta : []),
  ];
  for (const name of forward)
    if (request.headers.has(name)) headers.set(name, request.headers.get(name)!);
  let body: ArrayBuffer | undefined;
  if (["POST", "PUT", "DELETE"].includes(request.method)) {
    const binaryUpload = (cover && request.method === "PUT") || Boolean(gallery?.binary);
    const limit = binaryUpload ? 5 * 1024 * 1024 : 65536;
    if (binaryUpload && !["image/jpeg", "image/png", "image/webp"].includes(headers.get("content-type") ?? ""))
      return new Response(null,{status:415});
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      let expired = false;
      const timer = setTimeout(() => { expired = true; void reader.cancel(); },15000);
      try {
        for (;;) { const {done,value} = await reader.read(); if (expired) return new Response(null,{status:408}); if (done) break;
          size += value.byteLength;
          if (size > limit) { await reader.cancel(); return new Response(null,{status:413}); }
          chunks.push(value);
        }
      } catch { return new Response(null,{status:400}); }
      finally { clearTimeout(timer); reader.releaseLock(); }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    body = bytes.buffer;
  }
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

export const PUT = proxy;
export const DELETE = proxy;
