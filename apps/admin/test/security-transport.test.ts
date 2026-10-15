import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/v1/admin/[...path]/route";
import { adminCookies, internalConfig, sameOriginRequest } from "../src/lib/server-config";
import { freshStepUp, visibleNavigation, type Session } from "../src/lib/admin-client";
import { creationOptions, requestOptions } from "../src/lib/webauthn";

const origin = "http://localhost:18920";
function enabled() {
  vi.stubEnv("ADMIN_INTERNAL_APP_ENABLED", "1");
  vi.stubEnv("ADMIN_TEST_ORIGIN", origin);
  vi.stubEnv("ADMIN_TEST_API_URL", "http://127.0.0.1:18921");
}
function ctx(path: string) { return { params: Promise.resolve({ path: path.split("/") }) }; }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("internal Admin transport fence", () => {
  it("requires explicit local configuration and never accepts a public upstream/origin", () => {
    expect(internalConfig({})).toBeNull();
    for (const overrides of [{ ADMIN_TEST_ORIGIN: "https://admin.gobadminton.ru" }, { ADMIN_TEST_API_URL: "https://dev-api.gobadminton.ru" }, { ADMIN_TEST_API_URL: "http://127.0.0.1/evil" }, { ADMIN_TEST_API_URL: "http://token@127.0.0.1" }])
      expect(internalConfig({ ADMIN_INTERNAL_APP_ENABLED: "1", ADMIN_TEST_ORIGIN: origin, ADMIN_TEST_API_URL: "http://127.0.0.1:18921", ...overrides })).toBeNull();
  });
  it("rejects wrong and missing mutation Origin, cross-site safe reads, mismatched host", () => {
    expect(sameOriginRequest(new Request(origin, { method: "POST" }), origin)).toBe(false);
    expect(sameOriginRequest(new Request(origin, { headers: { origin: "http://127.0.0.1:18920" } }), origin)).toBe(false);
    expect(sameOriginRequest(new Request(origin, { headers: { "sec-fetch-site": "cross-site" } }), origin)).toBe(false);
    expect(sameOriginRequest(new Request("http://evil.test", { headers: { origin } }), origin)).toBe(false);
    expect(sameOriginRequest(new Request(origin, { headers: { "sec-fetch-site": "same-origin" } }), origin)).toBe(true);
  });
  it("strips consumer cookies and only permits the three accepted A0a host cookies", () => {
    expect(adminCookies("__Host-gb_session=consumer; __Host-gb_admin_session=admin; role=superadmin; __Host-gb_admin_handoff=csrf; __Host-gb_admin_mfa=ticket"))
      .toBe("__Host-gb_admin_session=admin; __Host-gb_admin_mfa=ticket");
  });
  it("disabled application and later feature routes never call upstream", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await GET(new Request(origin + "/v1/admin/auth/me"), ctx("auth/me"))).status).toBe(404);
    enabled();
    expect((await POST(new Request(origin + "/v1/admin/identity/commands", { method: "POST", headers: { origin } }), ctx("identity/commands"))).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("forwards same-origin safe GET with exact Origin, admin cookie and no bearer", async () => {
    enabled(); const fetch = vi.fn().mockResolvedValue(Response.json({ roles: ["support"] })); vi.stubGlobal("fetch", fetch);
    const result = await GET(new Request(origin + "/v1/admin/auth/me", { headers: { "sec-fetch-site": "same-origin", cookie: "__Host-gb_session=consumer; __Host-gb_admin_session=admin", authorization: "Bearer consumer" } }), ctx("auth/me"));
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    const [url, options] = fetch.mock.calls[0]!;
    expect(url.href).toBe("http://127.0.0.1:18921/v1/admin/auth/me");
    expect(options.headers.get("origin")).toBe(origin); expect(options.headers.get("cookie")).toBe("__Host-gb_admin_session=admin"); expect(options.headers.has("authorization")).toBe(false);
  });
  it("preserves logout 204 and forwards its CSRF and same-key retry", async () => {
    enabled(); const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204, headers: { "Set-Cookie": "__Host-gb_admin_session=; Path=/; Secure; HttpOnly; Max-Age=0" } })); vi.stubGlobal("fetch", fetch);
    const response = await POST(new Request(origin + "/v1/admin/auth/logout", { method: "POST", headers: { origin, "x-csrf-token": "csrf", "idempotency-key": "same-logout-key-1234" }, body: "{}" }), ctx("auth/logout"));
    expect(response.status).toBe(204); expect(await response.text()).toBe(""); expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(fetch.mock.calls[0]![1].headers.get("x-csrf-token")).toBe("csrf"); expect(fetch.mock.calls[0]![1].headers.get("idempotency-key")).toBe("same-logout-key-1234");
  });
  it("redirects bound provider callback without code/state/CSRF in navigation", async () => {
    enabled(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ csrfToken: "ticket-csrf", principalId: "synthetic", status: "pending_mfa" }, { headers: { "set-cookie": "__Host-gb_admin_mfa=ticket; Secure; HttpOnly; Path=/" } })));
    const response = await GET(new Request(origin + "/v1/admin/auth/vk/callback?state=secret&code=secret", { headers: { cookie: "__Host-gb_admin_binding=binding" } }), ctx("auth/vk/callback"));
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe(origin + "/?auth=complete");
    expect(response.headers.getSetCookie().join("; ")).toContain("SameSite=Strict"); expect(response.headers.getSetCookie().join("; ")).not.toContain("Domain=");
  });
  it("returns a safe unavailable result on upstream uncertainty without secret details", async () => {
    enabled(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret connection detail")));
    const result = await GET(new Request(origin + "/v1/admin/auth/me", { headers: { "sec-fetch-site": "same-origin" } }), ctx("auth/me"));
    expect(result.status).toBe(503); expect(await result.text()).not.toContain("secret");
  });
});
describe("navigation and passkey transport", () => {
  it("uses additive role affordances and denies unknown-role menus", () => {
    expect(visibleNavigation(["support"]).map(x => x.id)).toEqual(["overview", "cases"]);
    expect(visibleNavigation(["content_manager", "moderator"]).map(x => x.id)).toEqual(["overview", "venues", "games", "users", "cases"]);
    expect(visibleNavigation(["unknown"]).map(x => x.id)).toEqual(["overview"]);
    expect(visibleNavigation(["superadmin"])).toHaveLength(6);
  });
  it("marks exact ten-minute, future and invalid stepup stale", () => {
    const now = Date.now();
    for (const timestamp of [now - 600000, now + 1, NaN]) expect(freshStepUp({ stepUpAt: Number.isNaN(timestamp) ? "invalid" : new Date(timestamp).toISOString() } as Session, now)).toBe(false);
    expect(freshStepUp({ stepUpAt: new Date(now - 1).toISOString() } as Session, now)).toBe(true);
  });
  it("converts base64url challenge/user/credential IDs without changing UV/RP requirements", () => {
    const creation = creationOptions({ challenge: "AQID", rp: { id: "localhost", name: "Admin" }, user: { id: "BAUG", name: "synthetic", displayName: "synthetic" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { userVerification: "required" } });
    expect(Array.from(new Uint8Array(creation.challenge as ArrayBuffer))).toEqual([1, 2, 3]); expect(creation.authenticatorSelection?.userVerification).toBe("required");
    const request = requestOptions({ challenge: "AQID", rpId: "localhost", userVerification: "required", allowCredentials: [{ type: "public-key", id: "BAUG" }] });
    expect(Array.from(new Uint8Array(request.allowCredentials![0]!.id as ArrayBuffer))).toEqual([4, 5, 6]); expect(request.userVerification).toBe("required");
  });
});

describe("Germany DEV app fence", () => {
  const dev = {ADMIN_INTERNAL_APP_ENABLED:"1",ADMIN_DEV_ENABLED:"1",NODE_ENV:"production",APP_ENV:"stage",
    PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru",ADMIN_ORIGIN:"https://dev-admin.gobadminton.ru",ADMIN_API_URL:"https://dev.gobadminton.ru"};
  it("requires exact explicit separate HTTPS origins and denies PROD and mixed test config", () => {
    expect(internalConfig(dev)).toEqual({origin:dev.ADMIN_ORIGIN,api:dev.ADMIN_API_URL});
    for (const bad of [{APP_ENV:"prod"},{NODE_ENV:"test"},{ADMIN_DEV_ENABLED:"0"},
      {ADMIN_ORIGIN:dev.PUBLIC_WEB_ORIGIN},{ADMIN_API_URL:"https://token@dev.gobadminton.ru"},
      {ADMIN_TEST_ORIGIN:origin},{ADMIN_ORIGIN:"https://arbitrary.test"}]) expect(internalConfig({...dev,...bad})).toBeNull();
  });
});
