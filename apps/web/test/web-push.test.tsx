import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as PushClientModule from "../src/lib/push-client";
import type * as React from "react";
import {
  PushGameEventToggles,
  PushSettings,
  PUSH_DISCOVERABILITY_OFF_HINT,
  PUSH_IPHONE_HOMESCREEN_HINT,
  PUSH_MESSAGE_ENABLE_LABEL,
} from "../src/components/consumer/push/PushSettings";
import {
  bumpPushFenceGeneration,
  detectPushCapability,
  enqueuePushFenceMutation,
  getPushFenceGeneration,
  unsubscribePushDevice,
  urlBase64ToUint8Array,
} from "../src/lib/push-client";
import {
  markSessionPresence,
  resetSessionPresenceForTests,
} from "../src/lib/session-presence";

const pushHooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  cleanups: [] as Array<(() => void) | undefined>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useEffect(effect: () => void | (() => void)) {
      pushHooks.effects.push(effect);
    },
  };
});

import { PushLifecycle } from "../src/components/consumer/push/PushLifecycle";

vi.mock("next/link", () => ({
  default: (props: { href: string; children?: unknown }) =>
    createElement("a", { href: props.href }, props.children as never),
}));

const defaultEventPreferences = {
  invites: false,
  applicationDecisions: false,
  newApplications: false,
  gameChanges: false,
  outcomeReminders: false,
};

const getPushState = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true as const,
    status: 200,
    data: {
      featureAvailable: false,
      preferenceEnabled: false,
      preferenceVersion: 0,
      eventPreferences: { ...defaultEventPreferences },
      vapidPublicKey: null,
      accountFence: null,
      deviceCount: 0,
      maxDevices: 5,
      currentDevice: null,
      devices: [],
    },
  })),
);

const clearPushLocalBinding = vi.hoisted(() => vi.fn(async () => undefined));
const ensurePushServiceWorker = vi.hoisted(() => vi.fn(async () => null));
const detectPushCapabilityMock = vi.hoisted(() =>
  vi.fn(() => "unsupported" as const),
);

vi.mock("../src/lib/push-client", async () => {
  const actual = await vi.importActual<typeof PushClientModule>(
    "../src/lib/push-client",
  );
  return {
    ...actual,
    getPushState,
    clearPushLocalBinding,
    ensurePushServiceWorker,
    detectPushCapability: detectPushCapabilityMock,
  };
});

const me = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Тест",
  locale: "ru",
  linkedProviders: [] as string[],
  csrfToken: "csrf-token-for-test-only",
};

afterEach(() => {
  pushHooks.effects = [];
  pushHooks.cleanups.forEach((fn) => fn?.());
  pushHooks.cleanups = [];
  getPushState.mockClear();
  clearPushLocalBinding.mockClear();
  ensurePushServiceWorker.mockClear();
  detectPushCapabilityMock.mockReset();
  detectPushCapabilityMock.mockReturnValue("unsupported");
  resetSessionPresenceForTests();
  vi.unstubAllGlobals();
});

describe("#456 web push settings surface", () => {
  it("renders Russian settings copy without prompting on mount", () => {
    const html = renderToStaticMarkup(createElement(PushSettings, { me }));
    expect(html).toMatch(/aria-label="Уведомления"/);
    expect(html).toMatch(/<h2>Уведомления<\/h2>/);
    expect(PUSH_MESSAGE_ENABLE_LABEL).toBe("Включить уведомления о сообщениях");
    expect(html).not.toMatch(/requestPermission|PushManager\.subscribe/);
  });

  it("master OFF supported capability mentions games, postgame choices, and iPhone Home Screen", () => {
    detectPushCapabilityMock.mockReturnValue("ready");
    const html = renderToStaticMarkup(createElement(PushSettings, { me }));
    expect(html).toContain(PUSH_DISCOVERABILITY_OFF_HINT);
    expect(html).toContain(PUSH_IPHONE_HOMESCREEN_HINT);
    expect(html).toMatch(/приглашения/);
    expect(html).toMatch(/заявки и отмены/);
    expect(html).toMatch(/Подведите итоги/);
    expect(html).toMatch(/экран «Домой»/);
    expect(PUSH_MESSAGE_ENABLE_LABEL).toBe("Включить уведомления о сообщениях");
    expect(html).not.toMatch(/События игр/);
    expect(html).not.toMatch(/requestPermission|PushManager\.subscribe/);
    expect(getPushState).not.toHaveBeenCalled();
  });

  it("master ON five event toggles default OFF and forward callbacks", () => {
    const seen: Array<{ key: string; next: boolean }> = [];
    const onToggle = (key: keyof typeof defaultEventPreferences, next: boolean) => {
      seen.push({ key, next });
    };
    const tree = PushGameEventToggles({
      eventPreferences: { ...defaultEventPreferences },
      onToggle,
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toMatch(/События игр/);
    expect(html).toMatch(/Приглашения на игру/);
    expect(html).toMatch(/Решения по заявкам/);
    expect(html).toMatch(/Новые заявки/);
    expect(html).toMatch(/Отмена игры/);
    expect(html).toMatch(/Напоминания об итоге/);
    expect(html.match(/aria-checked="false"/g)?.length).toBe(5);
    expect(html).not.toMatch(/aria-checked="true"/);

    const list = (tree.props as { children?: React.ReactNode }).children;
    const nodes = Array.isArray(list) ? list : [list];
    const ul = nodes.find(
      (node) =>
        node &&
        typeof node === "object" &&
        "type" in node &&
        node.type === "ul",
    ) as React.ReactElement | undefined;
    const items = (ul?.props as { children?: React.ReactNode })?.children;
    const liNodes = (Array.isArray(items) ? items : [items]).filter(Boolean) as React.ReactElement[];
    expect(liNodes).toHaveLength(5);
    for (const li of liNodes) {
      const toggle = (li.props as { children?: React.ReactElement }).children;
      expect(toggle?.props?.on).toBe(false);
      (toggle?.props?.onClick as () => void)();
    }
    expect(seen).toEqual([
      { key: "invites", next: true },
      { key: "applicationDecisions", next: true },
      { key: "newApplications", next: true },
      { key: "gameChanges", next: true },
      { key: "outcomeReminders", next: true },
    ]);
  });

  it("PushLifecycle SSR renders without AppRouter / useRouter", () => {
    const html = renderToStaticMarkup(createElement(PushLifecycle));
    expect(html).toBe("");
  });

  it("guest with absent session clears stale SW binding without private GET", async () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", {});
    markSessionPresence("absent");
    pushHooks.effects = [];
    renderToStaticMarkup(createElement(PushLifecycle));
    expect(pushHooks.effects).toHaveLength(1);
    const cleanup = pushHooks.effects[0]!();
    pushHooks.cleanups.push(typeof cleanup === "function" ? cleanup : undefined);
    await vi.waitFor(() => expect(clearPushLocalBinding).toHaveBeenCalled());
    expect(getPushState).not.toHaveBeenCalled();
  });

  it("present session still loads push state after clear", async () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("navigator", {});
    markSessionPresence("present");
    pushHooks.effects = [];
    renderToStaticMarkup(createElement(PushLifecycle));
    const cleanup = pushHooks.effects[0]!();
    pushHooks.cleanups.push(typeof cleanup === "function" ? cleanup : undefined);
    await vi.waitFor(() => expect(getPushState).toHaveBeenCalled());
    expect(clearPushLocalBinding).toHaveBeenCalled();
  });

  it("unsubscribePushDevice sends required confirm:true JSON body", () => {
    const source = unsubscribePushDevice.toString();
    expect(source).toMatch(/confirm:\s*true/);
    expect(source).toMatch(/DELETE/);
  });

  it("exposes base64url helper and capability helper", () => {
    const bytes = urlBase64ToUint8Array("AQID");
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
    // Without browser APIs in node, detect may be unsupported.
    expect(["unsupported", "needs_homescreen", "ready", "denied", "offline"]).toContain(
      detectPushCapability(),
    );
  });

  it("serializes fence writes and drops stale out-of-order resolve before post", async () => {
    const posts: string[] = [];
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });

    const staleGen = bumpPushFenceGeneration();
    const stale = enqueuePushFenceMutation(staleGen, async (isCurrent) => {
      await staleGate;
      if (!isCurrent()) return;
      posts.push("stale");
    });

    const freshGen = bumpPushFenceGeneration();
    expect(freshGen).toBe(getPushFenceGeneration());
    await enqueuePushFenceMutation(freshGen, async (isCurrent) => {
      if (!isCurrent()) return;
      posts.push("fresh");
    });

    releaseStale();
    await stale;
    expect(posts).toEqual(["fresh"]);
  });
});
