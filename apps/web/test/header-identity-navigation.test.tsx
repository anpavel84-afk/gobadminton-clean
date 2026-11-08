/** @vitest-environment jsdom */
/**
 * #532 — mounted header identity: remount/route, deferred races, session switch,
 * expiry, profile refresh, multi-subscriber coalesce, SSR isolation.
 */
import { cleanup, render, screen, act, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("shows previous identity immediately while a deferred remount does not accept a stale guest read", async () => {
    const firstMe = deferred<{ ok: true; status: number; data: Me }>();
    const firstSocial = deferred<{ ok: true; status: number; data: OwnSocialProfile }>();
    transport.getMe.mockImplementationOnce(() => firstMe.promise);
    transport.getMySocialProfile.mockImplementationOnce(() => firstSocial.promise);

    const view = render(createElement(KeyedRoute, { path: "/games" }));
    await flushCoalesce();
    expect(screen.getByTestId("header").textContent).toBe("Профиль");

    await act(async () => {
      firstMe.resolve({ ok: true, status: 200, data: me("u1", "Анна") });
      await Promise.resolve();
    });
    await act(async () => {
      firstSocial.resolve({
        ok: true,
        status: 200,
        data: social("Анна", { uploadedUrl: uploadedA, providerUrl: null }),
      });
      await Promise.resolve();
    });
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
