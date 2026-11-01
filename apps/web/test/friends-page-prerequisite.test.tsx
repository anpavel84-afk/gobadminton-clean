import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { OwnSocialProfile } from "../src/lib/consumer-types";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMySocialProfile: vi.fn(),
}));

const friendships = vi.hoisted(() => ({
  getSocialCapabilities: vi.fn(),
  listFriends: vi.fn(),
}));

vi.mock("../src/lib/api-client", () => api);
vi.mock("../src/lib/friendships", () => friendships);
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href: string; children?: ReactNode; className?: string }) =>
      React.createElement("a", { href: props.href, className: props.className }, props.children),
  };
});
vi.mock("../src/components/consumer/ConsumerShell", () => ({
  ConsumerShell: ({ children }: { children: ReactNode }) => <div data-shell="">{children}</div>,
}));
vi.mock("../src/components/consumer/friends/FriendActions", () => ({
  FriendActions: () => null,
}));
vi.mock("../src/components/consumer/players/ProfileComposition", async () => {
  const React = await import("react");
  return {
    AuthEntry: (props: { returnPath: string }) =>
      React.createElement("div", { "data-auth-entry": props.returnPath }),
    Avatar: () => null,
    ProfileState: (props: { title: string; children?: ReactNode; state?: string; retry?: () => void }) =>
      React.createElement(
        "section",
        { "data-profile-state": props.title, "data-state": props.state },
        props.children,
        props.retry
          ? React.createElement("button", { type: "button", onClick: props.retry }, "Повторить")
          : null,
      ),
  };
});

import { FriendsPage } from "../src/components/consumer/pages/FriendsPage";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<{ deps: unknown[] | undefined; run: () => void }>,
  cleanups: [] as Array<(() => void) | undefined>,
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof ReactModule>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) {
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [
        hooks.slots[index],
        (value: T | ((previous: T) => T)) => {
          hooks.slots[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useRef<T>(initial: T) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index] as { current: T };
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = hooks.cursor++;
      const prev = hooks.slots[index] as unknown[] | undefined;
      if (!prev || !deps || deps.some((value, offset) => value !== prev[offset])) {
        hooks.slots[index] = deps;
        hooks.effects.push({
          deps,
          run: () => {
            hooks.cleanups[index]?.();
            hooks.cleanups[index] = effect() || undefined;
          },
        });
      }
    },
  };
});

const me = { id: "actor-a", csrfToken: "csrf-a", displayName: "Я" };

const baseProfile = (over: Partial<OwnSocialProfile> = {}): OwnSocialProfile => ({
  publicPlayerId: "own-1",
  version: 1,
  displayName: "Я",
  cityId: "city",
  areaKey: null,
  level: null,
  bio: null,
  directoryVisible: true,
  contactPolicy: "requests",
  consentPolicyVersion: null,
  optedInAt: null,
  radarConsented: false,
  radarConsentPolicyVersion: null,
  radarConsentedAt: null,
  socialEligible: true,
  trainer: false,
  lookingForGame: null,
  ...over,
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
}

function labelOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labelOf).join("");
  if (isValidElement(node)) return labelOf((node.props as { children?: unknown }).children);
  return "";
}

function flushEffects() {
  const queued = hooks.effects.splice(0);
  queued.forEach((entry) => entry.run());
}

function resetHooks() {
  hooks.cleanups.forEach((fn) => fn?.());
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function renderPage() {
  hooks.cursor = 0;
  const tree = FriendsPage();
  flushEffects();
  return tree;
}

beforeEach(() => {
  resetHooks();
  vi.resetAllMocks();
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
  }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  api.getMe.mockResolvedValue({ ok: true, status: 200, data: me });
});

afterEach(() => {
  resetHooks();
  vi.unstubAllGlobals();
});

describe("FriendsPage own-profile prerequisite (#445 / #436)", () => {
  it("hidden or version-0 own profile shows /profile guidance — not a false outage — and never lists friends", async () => {
    friendships.getSocialCapabilities.mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: false, gameRecommendations: false, gameAttention: false, socialPush: false },
    });
    api.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: baseProfile({ version: 0, directoryVisible: false, socialEligible: false }),
    });

    renderPage();
    await settle();
    const tree = renderPage();

    expect(labelOf(tree)).toContain("Сначала настройте свой профиль");
    expect(labelOf(tree)).toContain("Открыть профиль");
    expect(labelOf(tree)).not.toContain("Друзья сейчас недоступны");
    expect(elements(tree).some((el) => el.type === "a" && el.props.href === "/profile")).toBe(true);
    expect(friendships.listFriends).not.toHaveBeenCalled();
  });

  it("eligible own profile with friends=false stays genuinely unavailable and still skips the list", async () => {
    friendships.getSocialCapabilities.mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: false, gameRecommendations: false, gameAttention: false, socialPush: false },
    });
    api.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: baseProfile({ version: 2, directoryVisible: true, socialEligible: true }),
    });

    renderPage();
    await settle();
    const tree = renderPage();

    expect(labelOf(tree)).toContain("Друзья сейчас недоступны");
    expect(labelOf(tree)).not.toContain("Сначала настройте свой профиль");
    expect(friendships.listFriends).not.toHaveBeenCalled();
  });

  it("failed own-profile read is an explicit error with retry, not an empty friends list", async () => {
    friendships.getSocialCapabilities.mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: false, gameRecommendations: false, gameAttention: false, socialPush: false },
    });
    api.getMySocialProfile.mockResolvedValue({ ok: false, status: 500, error: "fail" });

    renderPage();
    await settle();
    const tree = renderPage();

    expect(elements(tree).some((el) => el.props["data-profile-state"] === "Не удалось загрузить друзей")).toBe(true);
    expect(labelOf(tree)).not.toContain("Здесь пока никого нет");
    expect(friendships.listFriends).not.toHaveBeenCalled();
  });

  it("friends=true still loads the accepted list (real empty stays empty)", async () => {
    friendships.getSocialCapabilities.mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: true, gameRecommendations: true, gameAttention: false, socialPush: false },
    });
    friendships.listFriends.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [], nextCursor: null, asOf: "2026-11-01T12:00:00.000Z" },
    });

    renderPage();
    await settle();
    const tree = renderPage();

    expect(friendships.listFriends).toHaveBeenCalledWith("accepted", null);
    expect(api.getMySocialProfile).not.toHaveBeenCalled();
    expect(labelOf(tree)).toContain("Здесь пока никого нет");
    expect(labelOf(tree)).not.toContain("Сначала настройте свой профиль");
  });
});
