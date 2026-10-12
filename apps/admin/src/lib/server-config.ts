export function internalConfig(env: Record<string, string | undefined> = process.env) {
  if (env.ADMIN_INTERNAL_APP_ENABLED !== "1") return null;
  try {
    const origin = new URL(env.ADMIN_TEST_ORIGIN ?? "");
    const api = new URL(env.ADMIN_TEST_API_URL ?? "");
    if (origin.hostname !== "localhost" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash ||
      !["http:", "https:"].includes(origin.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(api.hostname) ||
      api.username || api.password || api.pathname !== "/" || api.search || api.hash ||
      !["http:", "https:"].includes(api.protocol)) return null;
    return { origin: origin.origin, api: api.origin };
  } catch { return null; }
}

export function sameOriginRequest(request: Request, origin: string, callback = false) {
  if (new URL(request.url).origin !== origin) return false;
  const supplied = request.headers.get("origin");
  if (supplied && supplied !== origin) return false;
  if (callback && request.method === "GET") return true;
  if (request.method === "POST") return supplied === origin;
  return supplied === origin || request.headers.get("sec-fetch-site") === "same-origin";
}

export const HANDOFF_COOKIE = "__Host-gb_admin_handoff";
export const ADMIN_COOKIES = ["__Host-gb_admin_binding", "__Host-gb_admin_mfa", "__Host-gb_admin_session"];
export function adminCookies(raw: string) {
  return raw.split(";").map(x => x.trim()).filter(x => ADMIN_COOKIES.includes(x.split("=")[0] ?? "")).join("; ");
}
