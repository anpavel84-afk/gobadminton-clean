import { describe, expect, it } from "vitest";
import { headerAvatarUrls } from "../src/lib/header-identity";

const uploadedUrl = `/v1/media/avatars/${"a".repeat(64)}.png`;
describe("header image sink bounds", () => {
  it("orders owned upload before an allowed provider", () => {
    expect(headerAvatarUrls({ uploadedUrl, providerUrl: "https://avatars.yandex.net/account/photo" })).toEqual([uploadedUrl, "https://avatars.yandex.net/account/photo"]);
    expect(headerAvatarUrls({ uploadedUrl: null, providerUrl: "https://sun9.userapi.com/photo" })).toEqual(["https://sun9.userapi.com/photo"]);
    expect(headerAvatarUrls()).toEqual([]);
  });
  it.each([
    "http://avatars.yandex.net/photo", "https://avatars.yandex.net.evil.test/photo",
    "https://userapi.com/photo", "https://eviluserapi.com/photo", "https://userapi.com.evil.test/photo",
    "https://evil.test/photo", "https://name:secret@avatars.yandex.net/photo",
    "https://avatars.yandex.net:8443/photo", "//avatars.yandex.net/photo", "data:image/png;base64,AA",
    "https:///@avatars.yandex.net/a", "https:///:@avatars.yandex.net/", "https:////@sun9.userapi.com/a",
    "https://avatars.yandex.net@evil.example/phish",
  ])("denies unknown or credential-bearing provider %s", providerUrl => {
    expect(headerAvatarUrls({ uploadedUrl: null, providerUrl })).toEqual([]);
  });
  it.each(["/v1/media/covers/cover.png", "https://evil.test/photo", "//evil.test/photo", "/v1/media/avatars/../photo.png", `${uploadedUrl}?version=1`])("denies non-owned upload %s", value => {
    expect(headerAvatarUrls({ uploadedUrl: value, providerUrl: null })).toEqual([]);
  });
});

// Request-level bootstrap: exercise the actual layout, not implementation text.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, vi } from "vitest";
import { HeaderIdentityProvider, useHeaderIdentity } from "../src/lib/header-identity";

const request = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: request.cookies }));
vi.mock("next/font/google", () => ({ Onest: () => ({ variable: "font", className: "font" }) }));
vi.mock("../src/components/consumer/ViewportLock", () => ({ ViewportLock: () => null }));
vi.mock("../src/components/consumer/radar/RadarSessionProvider", () => ({
  RadarSessionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("../src/components/consumer/discovery/DiscoveryCityProvider", () => ({
  DiscoveryCityProvider: ({ children }: { children: unknown }) => children,
}));
import RootLayout from "../src/app/layout";

function ServerIdentity() {
  const { identity, loading } = useHeaderIdentity();
  return createElement("span", null, identity?.name ?? (loading ? "loading" : "guest"));
}
const cookieJar = (value?: string) => ({
  has: () => value !== undefined,
  get: () => value === undefined ? undefined : { value },
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("full-document request bootstrap", () => {
  it("isolates concurrent users and a guest and serializes only allowed presentation fields", async () => {
    vi.stubEnv("API_BASE_URL", "http://127.0.0.1:18985");
    request.cookies.mockResolvedValueOnce(cookieJar("session-A"))
      .mockResolvedValueOnce(cookieJar("session-B"))
      .mockResolvedValueOnce(cookieJar());
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const actor = new Headers(init.headers).get("Cookie") === "__Host-gb_session=session-A" ? "A" : "B";
      await new Promise(resolve => setTimeout(resolve, actor === "A" ? 5 : 0));
      return response(url.endsWith("/social-profile")
        ? { displayName: actor === "A" ? 'Анна <script>"&' : "Борис", avatar: { uploadedUrl, providerUrl: null }, email: "private@example.test", csrfToken: "private-csrf", providerName: "private-account" }
        : { id: actor, displayName: "private-account", csrfToken: "private-csrf" });
    });
    vi.stubGlobal("fetch", fetcher);
    const layouts = await Promise.all([0, 1, 2].map(() => RootLayout({ children: createElement(ServerIdentity) })));
    const html = layouts.map(layout => renderToStaticMarkup(layout));
    expect(html[0]).toContain("Анна &lt;script&gt;&quot;&amp;");
    expect(html[0]).not.toContain("Борис");
    expect(html[1]).toContain("Борис");
    expect(html[1]).not.toContain("Анна");
    expect(html[2]).toContain("guest");
    expect(html[2]).not.toMatch(/Анна|Борис/);
    // Check the actual client-bound provider props as well as HTML escaping.
    const serialized = JSON.stringify(layouts);
    expect(serialized).not.toMatch(/session-A|session-B|private@example|private-csrf|private-account/);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.cache).toBe("no-store");
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([401, 403, 404, 503])("does not invent identity from cookie presence or /me on social %s", async status => {
    vi.stubEnv("API_BASE_URL", "http://127.0.0.1:18985");
    request.cookies.mockResolvedValue(cookieJar("session"));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/social-profile")
      ? response({}, status) : response({ id: "A", displayName: "private@example.test" })));
    const layout = await RootLayout({ children: createElement(ServerIdentity) });
    const html = renderToStaticMarkup(layout);
    expect(html).toContain(status === 503 ? "loading" : "guest");
    expect(html).not.toContain("private@example.test");
  });

  it("uses a stable loading presentation when the server cannot reach the API", async () => {
    request.cookies.mockResolvedValue(cookieJar("session"));
    vi.stubEnv("API_BASE_URL", "http://127.0.0.1:18985");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(renderToStaticMarkup(await RootLayout({ children: createElement(ServerIdentity) }))).toContain("loading");
  });

  it("has no server cache even when two provider trees render in the same process", () => {
    const tree = (name: string) => createElement(HeaderIdentityProvider, {
      snapshot: { identity: { name }, imageGeneration: 0, loading: false },
      children: createElement(ServerIdentity),
    });
    expect(renderToStaticMarkup(tree("Анна"))).toBe("<span>Анна</span>");
    expect(renderToStaticMarkup(tree("Борис"))).toBe("<span>Борис</span>");
    expect(renderToStaticMarkup(createElement(ServerIdentity))).toBe("<span>loading</span>");
  });
});
