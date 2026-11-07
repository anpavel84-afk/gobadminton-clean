import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../src/lib/consumer-types";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<(() => void) | undefined>,
  push: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) {
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [
        hooks.slots[index] as T,
        (value: T | ((previous: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function"
              ? (value as (previous: T) => T)(hooks.slots[index] as T)
              : value;
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
      const previous = hooks.slots[index] as unknown[] | undefined;
      const nextDeps = deps ?? [];
      if (!previous || nextDeps.some((value, i) => !Object.is(value, previous[i]))) {
        hooks.slots[index] = nextDeps;
        hooks.effects.push(() => {
          hooks.cleanups[index]?.();
          const cleanup = effect();
          hooks.cleanups[index] = typeof cleanup === "function" ? cleanup : undefined;
        });
      }
    },
  };
});

const transport = vi.hoisted(() => ({
  getMe: vi.fn(),
  logout: vi.fn(),
  clearPushLocalBinding: vi.fn(),
}));

vi.mock("../src/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMe: (...args: unknown[]) => transport.getMe(...args),
    logout: (...args: unknown[]) => transport.logout(...args),
  };
});
vi.mock("../src/lib/push-client", () => ({
  clearPushLocalBinding: (...args: unknown[]) => transport.clearPushLocalBinding(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hooks.push, replace: hooks.push }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("../src/components/consumer/ConsumerShell", () => ({
  ConsumerShell: ({ children }: { children: ReactNode }) => <div data-shell="">{children}</div>,
}));
vi.mock("../src/components/consumer/players/GameContactPreference", () => ({
  GameContactPreference: () => null,
}));
vi.mock("../src/components/consumer/push/PushSettings", () => ({
  PushSettings: () => null,
}));
vi.mock("../src/components/consumer/players/ProfileComposition", () => ({
  AuthEntry: () => null,
  ProfileState: ({ title }: { title: string }) => <p>{title}</p>,
}));

import { apiFetch } from "../src/lib/api-client";
import { SettingsPage } from "../src/components/consumer/pages/SettingsPage";
import {
  getSessionPresence,
  markSessionPresence,
  resetSessionPresenceForTests,
  shouldSkipUnauthenticatedPrivateGet,
} from "../src/lib/session-presence";

const me: Me = {
  id: "actor-a",
  csrfToken: "csrf-a",
  displayName: "Actor A",
  locale: "ru",
  linkedProviders: [],
};

type Node = ReactElement<Record<string, unknown>>;
function nodes(tree: ReactNode): Node[] {
  const found: Node[] = [];
  function walk(node: ReactNode) {
    if (!isValidElement<Record<string, unknown>>(node)) return;
    found.push(node);
    Children.forEach(node.props.children as ReactNode, walk);
  }
  walk(tree);
  return found;
}

function resetHooks() {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
  hooks.push.mockReset();
}

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const run of queued) run();
}

function renderPage() {
  hooks.cursor = 0;
  const tree = SettingsPage();
  flushEffects();
  return tree;
}

function logoutButton(tree: ReactNode) {
  const button = nodes(tree).find(
    (node) => node.type === "button" && String(node.props.className).includes("settings-list__logout"),
  );
  if (!button) throw new Error("Missing settings logout button");
  return button;
}

beforeEach(() => {
  resetHooks();
  resetSessionPresenceForTests();
  markSessionPresence("present");
  transport.getMe.mockReset();
  transport.logout.mockReset();
  transport.clearPushLocalBinding.mockReset();
  transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me });
  transport.clearPushLocalBinding.mockResolvedValue(undefined);
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
    dispatchEvent: EventTarget.prototype.dispatchEvent,
  }));
  vi.stubGlobal("document", {
    documentElement: {
      getAttribute: () => "present",
      setAttribute: () => {},
    },
  });
});

afterEach(() => {
  resetHooks();
  resetSessionPresenceForTests();
  vi.unstubAllGlobals();
});

describe("SettingsPage logout presence (actual button fence)", () => {
  it("successful logout pins absent before consumers — no guest /me or /me/push HTTP", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    transport.logout.mockResolvedValue({ ok: true, status: 204, data: null });

    let tree = renderPage();
    await Promise.resolve();
    await Promise.resolve();
    tree = renderPage();

    const during: string[] = [];
    const consumerProbes: Array<{ path: string; status: number }> = [];
    const consumer = () => {
      during.push(getSessionPresence());
      expect(shouldSkipUnauthenticatedPrivateGet("/v1/me", "GET")).toBe(true);
      expect(shouldSkipUnauthenticatedPrivateGet("/v1/me/push", "GET")).toBe(true);
    };
    window.addEventListener("gb-session-changed", consumer);

    const button = logoutButton(tree);
    expect(button.props.disabled).toBe(false);
    await (button.props.onClick as () => void | Promise<void>)();
    await Promise.resolve();
    await Promise.resolve();

    // Actual transport consumers use apiFetch — absent presence must skip HTTP /me+/push.
    consumerProbes.push({ path: "/v1/me", status: (await apiFetch("/v1/me")).status });
    consumerProbes.push({ path: "/v1/me/push", status: (await apiFetch("/v1/me/push")).status });

    expect(transport.logout).toHaveBeenCalledWith("csrf-a", expect.objectContaining({
      notifySession: false,
      signal: expect.any(AbortSignal),
    }));
    expect(during).toEqual(["absent"]);
    expect(getSessionPresence()).toBe("absent");
    expect(hooks.push).toHaveBeenCalledWith("/games");
    expect(consumerProbes).toEqual([
      { path: "/v1/me", status: 401 },
      { path: "/v1/me/push", status: 401 },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401 logout is authoritative absent; 500 does not claim absence", async () => {
    transport.logout.mockResolvedValueOnce({ ok: false, status: 401, data: null, code: "UNAUTHORIZED" });
    let tree = renderPage();
    await Promise.resolve();
    await Promise.resolve();
    tree = renderPage();
    const during401: string[] = [];
    window.addEventListener("gb-session-changed", () => during401.push(getSessionPresence()));
    await (logoutButton(tree).props.onClick as () => void | Promise<void>)();
    await Promise.resolve();
    expect(during401).toEqual(["absent"]);
    expect(getSessionPresence()).toBe("absent");
    expect(hooks.push).toHaveBeenCalledWith("/games");

    resetHooks();
    resetSessionPresenceForTests();
    markSessionPresence("present");
    transport.getMe.mockResolvedValue({ ok: true, status: 200, data: me });
    transport.logout.mockResolvedValue({ ok: false, status: 500, data: null, code: "INTERNAL" });
    tree = renderPage();
    await Promise.resolve();
    await Promise.resolve();
    tree = renderPage();
    const during500: Array<{ presence: string; detail?: unknown }> = [];
    window.addEventListener("gb-session-changed", (event) => {
      during500.push({
        presence: getSessionPresence(),
        detail: (event as CustomEvent).detail,
      });
    });
    await (logoutButton(tree).props.onClick as () => void | Promise<void>)();
    await Promise.resolve();
    expect(during500).toEqual([{ presence: "unknown", detail: undefined }]);
    expect(getSessionPresence()).toBe("unknown");
    expect(hooks.push).not.toHaveBeenCalled();
    tree = renderPage();
    expect(nodes(tree).some((node) => typeof node.props.children === "string"
      && String(node.props.children).includes("Не удалось подтвердить выход"))).toBe(true);
  });

  it("aborted / superseded logout does not notify or pin absent", async () => {
    let resolveLogout!: (value: { ok: boolean; status: number; data: null; error?: string }) => void;
    const pending = new Promise<{ ok: boolean; status: number; data: null; error?: string }>((resolve) => {
      resolveLogout = resolve;
    });
    transport.logout.mockImplementation(async (_csrf: string, options: { signal?: AbortSignal }) => {
      const result = await pending;
      if (options.signal?.aborted) return { ok: false, status: 0, data: null, error: "Aborted" };
      return result;
    });
    let tree = renderPage();
    await Promise.resolve();
    await Promise.resolve();
    tree = renderPage();
    const changed = vi.fn();
    window.addEventListener("gb-session-changed", changed);
    const click = logoutButton(tree).props.onClick as () => void | Promise<void>;
    const running = click();
    // Epoch bump / unmount aborts the in-flight settings logout fence.
    resetHooks();
    resolveLogout({ ok: true, status: 204, data: null });
    await running;
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(getSessionPresence()).toBe("present");
    expect(hooks.push).not.toHaveBeenCalled();
  });
});
