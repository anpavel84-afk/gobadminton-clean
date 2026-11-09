/** @vitest-environment jsdom */
/**
 * #532 — mounted header identity: remount/route, deferred races, session switch,
 * expiry, profile refresh, multi-subscriber coalesce, SSR isolation.
 */
import { cleanup, render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { Me, OwnSocialProfile, PlayerAvatar } from "../src/lib/consumer-types";

const transport = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMySocialProfile: vi.fn(),
  meCalls: 0,
  socialCalls: 0,
}));

vi.mock("../src/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMe: (...args: unknown[]) => {
      transport.meCalls += 1;
      return transport.getMe(...args);
    },
    getMySocialProfile: (...args: unknown[]) => {
      transport.socialCalls += 1;
      return transport.getMySocialProfile(...args);
    },
  };
});

import {
  HeaderIdentityProvider,
  headerAvatarUrls,
  resetHeaderIdentityStoreForTests,
  useHeaderIdentity,
} from "../src/lib/header-identity";

const uploadedA = `/v1/media/avatars/${"a".repeat(64)}.png`;
const uploadedB = `/v1/media/avatars/${"b".repeat(64)}.png`;

function me(id: string, displayName: string, csrf = `csrf-${id}`): Me {
  return { id, displayName, locale: "ru", linkedProviders: [], csrfToken: csrf };
}

function social(displayName: string, avatar?: PlayerAvatar): OwnSocialProfile {
  return {
    publicPlayerId: "public-1",
    version: 1,
    displayName,
    cityId: null,
    areaKey: null,
    level: null,
    bio: null,
    directoryVisible: false,
    contactPolicy: "closed",
    consentPolicyVersion: null,
    optedInAt: null,
    radarConsented: false,
    radarConsentPolicyVersion: null,
    radarConsentedAt: null,
    socialEligible: true,
    trainer: false,
    lookingForGame: null,
    avatar,
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function HeaderProbe({ label = "probe" }: { label?: string }) {
  const { identity, imageGeneration } = useHeaderIdentity();
  return createElement(
    "div",
    { "data-testid": label, "data-generation": String(imageGeneration) },
    identity ? `Профиль: ${identity.name}` : "Профиль",
    identity?.avatar?.uploadedUrl
      ? createElement("img", { alt: "", src: identity.avatar.uploadedUrl })
      : null,
  );
}

function KeyedRoute({ path }: { path: string }) {
  return createElement("div", { "data-route": path }, createElement(HeaderProbe, { key: path, label: "header" }));
}

function DualSubscribers() {
  return createElement(
    "div",
    null,
    createElement(HeaderProbe, { label: "one" }),
    createElement(HeaderProbe, { label: "two" }),
  );
}

async function flushCoalesce() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  });
}

beforeEach(() => {
  resetHeaderIdentityStoreForTests();
  transport.meCalls = 0;
  transport.socialCalls = 0;
  transport.getMe.mockReset();
  transport.getMySocialProfile.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  cleanup();
  resetHeaderIdentityStoreForTests();
  vi.restoreAllMocks();
});

describe("header identity navigation / remount", () => {
  it("keeps identity across keyed remount without a second /me + social pair or image-generation reset", async () => {
    const avatar = { uploadedUrl: uploadedA, providerUrl: null as string | null };
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Анна Альфа", avatar),
    });

    const view = render(createElement(KeyedRoute, { path: "/my-games" }));
    await flushCoalesce();
    await waitFor(() => expect(screen.getByTestId("header").textContent).toBe("Профиль: Анна Альфа"));
    const generation = screen.getByTestId("header").getAttribute("data-generation");
    expect(transport.meCalls).toBe(1);
    expect(transport.socialCalls).toBe(1);

    view.rerender(createElement(KeyedRoute, { path: "/players" }));
    expect(screen.getByTestId("header").textContent).toBe("Профиль: Анна Альфа");
    expect(screen.getByTestId("header").getAttribute("data-generation")).toBe(generation);
    await flushCoalesce();
    await act(async () => {
      await Promise.resolve();
    });
    expect(transport.meCalls).toBe(1);
    expect(transport.socialCalls).toBe(1);
    expect(screen.getByTestId("header").querySelector("img")?.getAttribute("src")).toBe(uploadedA);
  });

  it("remounts before pending me/social resolve and keeps one coalesced operation", async () => {
    const pendingMe = deferred<{ ok: true; status: number; data: Me }>();
    const pendingSocial = deferred<{ ok: true; status: number; data: OwnSocialProfile }>();
    transport.getMe.mockImplementationOnce(() => pendingMe.promise);
    transport.getMySocialProfile.mockImplementationOnce(() => pendingSocial.promise);

    const view = render(createElement(KeyedRoute, { path: "/games" }));
    await flushCoalesce();
    expect(screen.getByTestId("header").textContent).toBe("Профиль");
    expect(transport.meCalls).toBe(1);
    expect(transport.socialCalls).toBe(0);

    // Remount while /me is still outstanding — must reuse the in-flight operation.
    view.rerender(createElement(KeyedRoute, { path: "/my-games" }));
    expect(screen.getByTestId("header").textContent).toBe("Профиль");
    expect(transport.meCalls).toBe(1);
    expect(transport.socialCalls).toBe(0);

    await act(async () => {
      pendingMe.resolve({ ok: true, status: 200, data: me("u1", "Анна") });
      await Promise.resolve();
    });
    expect(screen.getByTestId("header").textContent).toBe("Профиль");
    expect(transport.meCalls).toBe(1);
    expect(transport.socialCalls).toBe(1);

    await act(async () => {
      pendingSocial.resolve({
        ok: true,
        status: 200,
        data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("header").textContent).toBe("Профиль: Анна"));
    expect(screen.getByTestId("header").querySelector("img")?.getAttribute("src")).toBe(uploadedA);
    expect(transport.meCalls).toBe(1);
    expect(transport.socialCalls).toBe(1);

    // After-resolved navigation still keeps the confirmed paint without a new pair.
    const generation = screen.getByTestId("header").getAttribute("data-generation");
    view.rerender(createElement(KeyedRoute, { path: "/players" }));
    expect(screen.getByTestId("header").textContent).toBe("Профиль: Анна");
    expect(screen.getByTestId("header").getAttribute("data-generation")).toBe(generation);
    await flushCoalesce();
    expect(transport.meCalls).toBe(1);
    expect(transport.socialCalls).toBe(1);
  });

  it("rejects a stale guest read after session switch without painting over the new actor", async () => {
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
    });

    const view = render(createElement(KeyedRoute, { path: "/games" }));
    await flushCoalesce();
    await waitFor(() => expect(screen.getByTestId("header").textContent).toBe("Профиль: Анна"));

    const lateGuest = deferred<{ ok: false; status: number; error: string }>();
    transport.getMe.mockImplementationOnce(() => lateGuest.promise);
    window.dispatchEvent(new Event("gb-session-changed"));
    await flushCoalesce();
    expect(screen.getByTestId("header").textContent).toBe("Профиль");

    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u2", "Борис") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Борис", { uploadedUrl: uploadedB, providerUrl: null }),
    });
    window.dispatchEvent(new Event("gb-session-changed"));
    await flushCoalesce();
    await waitFor(() => expect(screen.getByTestId("header").textContent).toBe("Профиль: Борис"));

    await act(async () => {
      lateGuest.resolve({ ok: false, status: 401, error: "HTTP 401" });
      await Promise.resolve();
    });
    expect(screen.getByTestId("header").textContent).toBe("Профиль: Борис");

    view.rerender(createElement(KeyedRoute, { path: "/my-games" }));
    expect(screen.getByTestId("header").textContent).toBe("Профиль: Борис");
  });

  it("preserves confirmed identity on temporary getMe failure and clears on 401 / session invalidation", async () => {
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
    });

    render(createElement(HeaderProbe));
    await flushCoalesce();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна"));
    const generation = screen.getByTestId("probe").getAttribute("data-generation");
    const meBefore = transport.meCalls;

    for (const status of [0, 408, 503] as const) {
      transport.getMe.mockResolvedValueOnce({ ok: false, status, error: `HTTP ${status}` });
      await act(async () => {
        window.dispatchEvent(new Event("gb-profile-changed"));
      });
      await flushCoalesce();
      expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна");
      expect(screen.getByTestId("probe").getAttribute("data-generation")).toBe(generation);
      expect(screen.getByTestId("probe").querySelector("img")?.getAttribute("src")).toBe(uploadedA);
      expect(transport.socialCalls).toBe(1);
    }
    expect(transport.meCalls).toBe(meBefore + 3);

    transport.getMe.mockResolvedValueOnce({ ok: false, status: 401, error: "HTTP 401" });
    await act(async () => {
      window.dispatchEvent(new Event("gb-profile-changed"));
    });
    await flushCoalesce();
    expect(screen.getByTestId("probe").textContent).toBe("Профиль");
    expect(screen.getByTestId("probe").querySelector("img")).toBeNull();

    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
    });
    window.dispatchEvent(new Event("gb-session-changed"));
    await flushCoalesce();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна"));

    await act(async () => {
      window.dispatchEvent(new Event("gb-private-expired"));
    });
    expect(screen.getByTestId("probe").textContent).toBe("Профиль");
  });

  it("coalesces simultaneous subscribers into one /me + social pair", async () => {
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
    });
    render(createElement(DualSubscribers));
    await flushCoalesce();
    await waitFor(() => {
      expect(screen.getByTestId("one").textContent).toBe("Профиль: Анна");
      expect(screen.getByTestId("two").textContent).toBe("Профиль: Анна");
    });
    expect(transport.meCalls).toBe(1);
    expect(transport.socialCalls).toBe(1);
  });

  it("clears immediately on expiry with no subscribers and rejects late success", async () => {
    const lateSocial = deferred<{ ok: true; status: number; data: OwnSocialProfile }>();
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile.mockImplementationOnce(() => lateSocial.promise);

    const view = render(createElement(HeaderProbe));
    await flushCoalesce();
    expect(transport.meCalls).toBe(1);

    view.unmount();
    expect(transport.socialCalls).toBe(1);

    window.dispatchEvent(new Event("gb-private-expired"));

    await act(async () => {
      lateSocial.resolve({
        ok: true,
        status: 200,
        data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
      });
      await Promise.resolve();
    });

    const again = render(createElement(HeaderProbe));
    expect(again.getByTestId("probe").textContent).toBe("Профиль");
    // started already true for this window — remount after expiry must not paint stale late success
    await flushCoalesce();
    expect(again.getByTestId("probe").textContent).toBe("Профиль");
  });

  it("clears on session/account switch even between mounts and loads the new actor", async () => {
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
    });
    const first = render(createElement(HeaderProbe));
    await flushCoalesce();
    await waitFor(() => expect(first.getByTestId("probe").textContent).toBe("Профиль: Анна"));
    first.unmount();

    window.dispatchEvent(new Event("gb-session-changed"));
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u2", "Борис") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Борис", { uploadedUrl: uploadedB, providerUrl: null }),
    });

    const second = render(createElement(HeaderProbe));
    expect(second.getByTestId("probe").textContent).toBe("Профиль");
    await flushCoalesce();
    await waitFor(() => expect(second.getByTestId("probe").textContent).toBe("Профиль: Борис"));
    expect(second.getByTestId("probe").querySelector("img")?.getAttribute("src")).toBe(uploadedB);
  });

  it("refreshes on profile-changed without clearing current identity", async () => {
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: social("Анна Новая", { uploadedUrl: uploadedA, providerUrl: null }),
      });

    render(createElement(HeaderProbe));
    await flushCoalesce();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна"));
    const generation = screen.getByTestId("probe").getAttribute("data-generation");

    await act(async () => {
      window.dispatchEvent(new Event("gb-profile-changed"));
    });
    expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна");
    await flushCoalesce();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна Новая"));
    // Same avatar URLs — image generation stays stable while name updates.
    expect(screen.getByTestId("probe").getAttribute("data-generation")).toBe(generation);
  });

  it("preserves confirmed identity on transient social failure and does not cache guest forever after login", async () => {
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503, error: "HTTP 503" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
      });

    render(createElement(HeaderProbe));
    await flushCoalesce();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна"));

    await act(async () => {
      window.dispatchEvent(new Event("gb-profile-changed"));
    });
    await flushCoalesce();
    expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна");
    cleanup();

    resetHeaderIdentityStoreForTests();
    transport.meCalls = 0;
    transport.socialCalls = 0;
    transport.getMe.mockResolvedValue({ ok: false, status: 401, error: "HTTP 401" });
    const guest = render(createElement(HeaderProbe));
    await flushCoalesce();
    await waitFor(() => expect(guest.getByTestId("probe").textContent).toBe("Профиль"));
    guest.unmount();

    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u1", "Анна") });
    transport.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
    });
    // Login event must invalidate any guest failure and load the new session identity.
    window.dispatchEvent(new Event("gb-session-changed"));
    const loggedIn = render(createElement(HeaderProbe));
    await flushCoalesce();
    await waitFor(() => expect(loggedIn.getByTestId("probe").textContent).toBe("Профиль: Анна"));
  });

  it("keeps SSR / server snapshot empty and does not share user-specific module state", () => {
    function ServerHeader() {
      const { identity } = useHeaderIdentity();
      return createElement("span", null, identity ? identity.name : "empty");
    }
    const html = renderToStaticMarkup(createElement(ServerHeader));
    expect(html).toContain("empty");
    expect(html).not.toMatch(/Анна|Борис/);
  });
});

describe("header image sink bounds (reuse)", () => {
  it("orders owned upload before an allowed provider", () => {
    expect(headerAvatarUrls({ uploadedUrl: uploadedA, providerUrl: "https://avatars.yandex.net/account/photo" })).toEqual([
      uploadedA,
      "https://avatars.yandex.net/account/photo",
    ]);
  });

  it.each([
    "http://avatars.yandex.net/photo",
    "https://avatars.yandex.net.evil.test/photo",
    "https://userapi.com/photo",
    "https://name:secret@avatars.yandex.net/photo",
  ])("denies unknown or credential-bearing provider %s", (providerUrl) => {
    expect(headerAvatarUrls({ uploadedUrl: null, providerUrl })).toEqual([]);
  });
});


describe("new document bootstrap / hydration", () => {
  const boot = {
    identity: { name: "Анна Альфа", avatar: { uploadedUrl: uploadedA, providerUrl: null } },
    imageGeneration: 0, loading: false, ownerId: "u1",
  };
  const documentTree = () => createElement(HeaderIdentityProvider, {
    snapshot: boot, children: createElement(HeaderProbe),
  });

  it("shows confirmed identity in server HTML and every hydration paint while me and social are delayed", async () => {
    const pendingMe = deferred<{ ok: true; status: number; data: Me }>();
    const pendingSocial = deferred<{ ok: true; status: number; data: OwnSocialProfile }>();
    transport.getMe.mockReturnValue(pendingMe.promise);
    transport.getMySocialProfile.mockReturnValue(pendingSocial.promise);
    const container = document.createElement("main");
    // A new document, not a keyed remount: no memory is allowed to supply its identity.
    resetHeaderIdentityStoreForTests();
    container.innerHTML = renderToStaticMarkup(documentTree());
    document.body.append(container);
    const labels = [container.textContent];
    const observer = new MutationObserver(() => labels.push(container.textContent));
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    // Commit hydration and its subscription before waiting for revalidation.
    await act(async () => {
      root = hydrateRoot(container, documentTree(), { onRecoverableError: error => errors.push(error) });
    });
    try {
      await waitFor(() => expect(transport.meCalls).toBe(1));
      expect(container.textContent).toBe("Профиль: Анна Альфа");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(uploadedA);
      await act(async () => { pendingMe.resolve({ ok: true, status: 200, data: me("u1", "private@example.test") }); });
      await waitFor(() => expect(transport.socialCalls).toBe(1));
      expect(container.textContent).toBe("Профиль: Анна Альфа");
      await act(async () => { pendingSocial.resolve({ ok: true, status: 200, data: social("Анна Альфа", boot.identity.avatar) }); });
      expect(new Set(labels)).toEqual(new Set(["Профиль: Анна Альфа"]));
      expect(errors).toEqual([]);
      expect(transport.meCalls).toBe(1);
      expect(transport.socialCalls).toBe(1);
      expect(container.querySelector("[data-generation]")?.getAttribute("data-generation")).toBe("0");
    } finally {
      observer.disconnect();
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("drops request A before waiting for account B's social profile, never falling back to provider name", async () => {
    const pendingSocial = deferred<{ ok: false; status: number; error: string }>();
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me("u2", "private@example.test") });
    transport.getMySocialProfile.mockReturnValue(pendingSocial.promise);
    render(documentTree());
    expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна Альфа");
    await flushCoalesce();
    expect(screen.getByTestId("probe").textContent).toBe("Профиль");
    expect(screen.getByTestId("probe").querySelector("img")).toBeNull();
    await act(async () => pendingSocial.resolve({ ok: false, status: 503, error: "offline" }));
    expect(screen.getByTestId("probe").textContent).toBe("Профиль");
  });

  it("clears server identity immediately on logout and fences pending responses", async () => {
    const pendingMe = deferred<{ ok: true; status: number; data: Me }>();
    transport.getMe.mockReturnValue(pendingMe.promise);
    render(documentTree());
    await flushCoalesce();
    await act(async () => { window.dispatchEvent(new CustomEvent("gb-session-changed", { detail: { sessionPresence: "absent" } })); });
    expect(screen.getByTestId("probe").textContent).toBe("Профиль");
    await act(async () => pendingMe.resolve({ ok: true, status: 200, data: me("u1", "Анна") }));
    expect(screen.getByTestId("probe").querySelector("img")).toBeNull();
  });

  it("works when browser storage APIs throw and retains server presentation only on a transient same-document failure", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    transport.getMe.mockResolvedValue({ ok: false, status: 503, error: "offline" });
    render(documentTree());
    await flushCoalesce();
    expect(screen.getByTestId("probe").textContent).toBe("Профиль: Анна Альфа");
    transport.getMe.mockResolvedValue({ ok: false, status: 401, error: "revoked" });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flushCoalesce();
    expect(screen.getByTestId("probe").querySelector("img")).toBeNull();
    expect(screen.getByTestId("probe").textContent).toBe("Профиль");
  });
});


vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/help" }));
vi.mock("../src/components/consumer/radar/RadarSessionProvider", () => ({ RadarStatusAffordance: () => null }));
import { DesktopNav } from "../src/components/consumer/RootNav";

describe("full-document profile action", () => {
  it("keeps a named accessible profile target and avatar through delayed revalidation and bounded image fallback", async () => {
    const pending = deferred<{ ok: true; status: number; data: Me }>();
    transport.getMe.mockReturnValue(pending.promise);
    render(createElement(HeaderIdentityProvider, {
      snapshot: { identity: { name: "Анна", avatar: { uploadedUrl: uploadedA, providerUrl: "https://avatars.yandex.net/photo" } }, imageGeneration: 0, loading: false, ownerId: "u1" },
      children: createElement(DesktopNav, { active: "games" }),
    }));
    const profile = screen.getByRole("link", { name: "Профиль: Анна" });
    expect(profile.getAttribute("href")).toBe("/profile");
    await flushCoalesce();
    const image = profile.querySelector("img")!;
    fireEvent.error(image);
    expect(profile.querySelector("img")?.getAttribute("src")).toBe("https://avatars.yandex.net/photo");
    fireEvent.error(profile.querySelector("img")!);
    expect(profile.querySelector("img")).toBeNull();
    expect(profile.querySelector(".gb-header-avatar")?.textContent).toBe("А");
    expect(profile.getAttribute("aria-label")).toBe("Профиль: Анна");
  });

  it("falls back when an SSR avatar failed before React could attach onError", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    transport.getMe.mockReturnValue(new Promise(() => {}));
    render(createElement(HeaderIdentityProvider, {
      snapshot: { identity: { name: "Анна", avatar: { uploadedUrl: uploadedA, providerUrl: "https://avatars.yandex.net/photo" } }, imageGeneration: 0, loading: false, ownerId: "u1" },
      children: createElement(DesktopNav, { active: "games" }),
    }));
    const profile = screen.getByRole("link", { name: "Профиль: Анна" });
    expect(profile.querySelector("img")).toBeNull();
    expect(profile.querySelector(".gb-header-avatar")?.textContent).toBe("А");
  });

  it("uses an intentional loading action on the first document without established identity", async () => {
    transport.getMe.mockReturnValue(new Promise(() => {}));
    render(createElement(DesktopNav, { active: "games" }));
    const profile = screen.getByRole("link", { name: "Профиль: загрузка" });
    expect(profile.getAttribute("aria-busy")).toBe("true");
    expect(profile.getAttribute("href")).toBe("/profile");
    expect(profile.querySelector(".gb-header-avatar")?.textContent).toBe("…");
    expect(profile.querySelector(".gb-header-profile-label")?.textContent).toBe("Загрузка…");
    await flushCoalesce();
    expect(profile.getAttribute("aria-busy")).toBe("true");
  });
});
