import {
  Children,
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { socialError } from "../src/lib/messaging-presentation";
import type { Me } from "../src/lib/consumer-types";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<(() => void) | undefined>,
}));

const foreground = vi.hoisted(() => ({
  load: null as null | ((cycle: { signal: AbortSignal; resume: boolean }) => Promise<unknown>),
  listener: null as null | ((result: unknown) => void),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState<T>(initial: T) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
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
      return hooks.slots[index];
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
vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => createElement("a", props),
}));
vi.mock("../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
  getGame: vi.fn(),
  getMySocialProfile: vi.fn(),
}));
vi.mock("../src/lib/messaging-api", () => ({
  gameChatPath: (id: string) => `/v1/games/${encodeURIComponent(id)}/chat`,
  getGameChat: vi.fn(),
  listGameChatMessages: vi.fn(),
  listGameChatMembers: vi.fn(),
}));
vi.mock("../src/lib/foreground-updates", () => ({
  privateActor: (me: { id: string }) => me.id,
  foregroundUpdates: {
    session: vi.fn(),
    invalidate: vi.fn(),
    subscribe: (
      _key: string,
      _interval: number,
      load: (cycle: { signal: AbortSignal; resume: boolean }) => Promise<unknown>,
      listener: (result: unknown) => void,
    ) => {
      foreground.load = load;
      foreground.listener = listener;
      return () => {
        foreground.load = null;
        foreground.listener = null;
      };
    },
  },
}));
vi.mock("../src/components/consumer/messages/ConversationSafety", () => ({
  ConversationSafety: () => null,
}));
vi.mock("../src/components/consumer/players/ProfileComposition", () => ({
  ProfileState: (props: { title?: string; state?: string; children?: ReactNode }) =>
    createElement("div", { "data-profile-state": props.state ?? "ok" }, props.title, props.children),
  AuthEntry: () => createElement("div", { "data-auth": "1" }),
  ProfileDialog: (props: { children?: ReactNode }) => createElement("div", null, props.children),
}));

import { apiFetch, getGame, getMySocialProfile } from "../src/lib/api-client";
import {
  getGameChat,
  listGameChatMembers,
  listGameChatMessages,
} from "../src/lib/messaging-api";
import { useSocialMutation } from "../src/components/consumer/messages/useSocialMutation";
import { GameConversation } from "../src/components/consumer/messages/GameConversation";

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

function expand(node: ReactNode): ReactNode {
  if (node == null || typeof node === "boolean") return node;
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement(node)) return node;
  if (typeof node.type === "function") {
    return expand(
      (node.type as (props: Record<string, unknown>) => ReactNode)(
        node.props as Record<string, unknown>,
      ),
    );
  }
  const children = (node.props as { children?: ReactNode }).children;
  if (children == null) return node;
  return cloneElement(node, undefined, Children.map(children, (child) => expand(child)));
}

function walk(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (node == null || typeof node === "boolean") return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node as ReactElement);
  const props = node.props as { children?: ReactNode };
  Children.forEach(props.children, (child) => walk(child, out));
  return out;
}

describe("private message safety UX", () => {
  const success = vi.fn();
  const refresh = vi.fn();
  const storage = new Map<string, string>();

  function renderMutation(scope = "actor:game") {
    hooks.cursor = 0;
    useSocialMutation(scope, "csrf", success, refresh);
    flushEffects();
    hooks.cursor = 0;
    return useSocialMutation(scope, "csrf", success, refresh);
  }

  beforeEach(() => {
    hooks.slots = [];
    hooks.cursor = 0;
    hooks.effects = [];
    hooks.cleanups = [];
    foreground.load = null;
    foreground.listener = null;
    storage.clear();
    vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "shared-key" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });
  afterEach(() => {
    hooks.cleanups.forEach((fn) => fn?.());
    vi.unstubAllGlobals();
  });

  it("maps local private policy codes to neutral composer copy", () => {
    expect(
      socialError({
        ok: false,
        status: 422,
        error: "x",
        problem: {
          code: "PRIVATE_TEXT_CONTENT_REJECTED",
          title: "t",
          status: 422,
          type: "",
          requestId: "",
        },
      }),
    ).toMatch(/не отправлено/i);
    expect(
      socialError({
        ok: false,
        status: 429,
        error: "x",
        problem: {
          code: "PRIVATE_TEXT_RATE_LIMITED",
          title: "t",
          status: 429,
          type: "",
          requestId: "",
        },
      }),
    ).toMatch(/подождите|позже|много/i);
  });

  it("passes policy 422/429 failure details to onRefresh for draft retention hosts", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 422,
      error: "rejected",
      problem: {
        code: "PRIVATE_TEXT_CONTENT_REJECTED",
        title: "t",
        status: 422,
        type: "",
        requestId: "",
      },
    } as never);
    const mutation = renderMutation();
    expect(mutation.run("/v1/games/g/chat/messages", { text: "x", clientMessageId: "1" })).toBe(
      true,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledWith({
      status: 422,
      code: "PRIVATE_TEXT_CONTENT_REJECTED",
    });

    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 403,
      error: "forbidden",
      problem: {
        code: "RESOURCE_UNAVAILABLE",
        title: "t",
        status: 403,
        type: "",
        requestId: "",
      },
    } as never);
    const mutation2 = renderMutation("actor:game2");
    mutation2.run("/v1/games/g/chat/messages", { text: "y", clientMessageId: "2" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledWith({
      status: 403,
      code: "RESOURCE_UNAVAILABLE",
    });
  });

  it("GameConversation retains draft on policy 422/429 and clears on access loss", async () => {
    const me: Me = {
      id: "actor-1",
      displayName: "Actor",
      locale: "ru",
      linkedProviders: [],
      csrfToken: "csrf",
    };
    const changed = vi.fn();
    const draft = "Черновик для правки после отказа";

    vi.mocked(getGameChat).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        gameId: "game-1",
        lifecycleState: "active",
        readThroughSeq: "0",
      },
    } as never);
    vi.mocked(listGameChatMessages).mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [], nextCursor: null },
    } as never);
    vi.mocked(listGameChatMembers).mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    } as never);
    vi.mocked(getGame).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: "game-1",
        title: "Игра",
        startsAt: "2030-01-01T12:00:00Z",
        timezone: "Europe/Moscow",
      },
    } as never);
    vi.mocked(getMySocialProfile).mockResolvedValue({
      ok: true,
      status: 200,
      data: { publicPlayerId: "own" },
    } as never);

    function renderTree() {
      hooks.cursor = 0;
      const tree = expand(createElement(GameConversation, { id: "game-1", me, changed }));
      flushEffects();
      return tree;
    }

    async function settleReady() {
      renderTree();
      expect(foreground.load).toBeTruthy();
      const result = await foreground.load!({
        signal: new AbortController().signal,
        resume: false,
      });
      foreground.listener?.(result);
      return renderTree();
    }

    let tree = await settleReady();
    let nodes = walk(tree);
    let input = nodes.find(
      (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
    );
    expect(input).toBeTruthy();
    (input!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: draft },
    });
    tree = renderTree();
    nodes = walk(tree);
    input = nodes.find(
      (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
    );
    expect(input?.props.value).toBe(draft);

    const form = nodes.find((n) => n.type === "form" && n.props.className === "composer");
    expect(form).toBeTruthy();

    async function submitWithFailure(status: number, code: string) {
      vi.mocked(apiFetch).mockResolvedValue({
        ok: false,
        status,
        error: "fail",
        problem: { code, title: "t", status, type: "", requestId: "" },
      } as never);
      tree = renderTree();
      nodes = walk(tree);
      const liveForm = nodes.find((n) => n.type === "form" && n.props.className === "composer");
      expect(liveForm).toBeTruthy();
      (liveForm!.props.onSubmit as (e: { preventDefault: () => void }) => void)({
        preventDefault() {},
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      return renderTree();
    }

    tree = await submitWithFailure(422, "PRIVATE_TEXT_CONTENT_REJECTED");
    nodes = walk(tree);
    input = nodes.find(
      (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
    );
    expect(input?.props.value).toBe(draft);
    expect(nodes.some((n) => n.props?.className === "chat-access-loss")).toBe(false);

    tree = await submitWithFailure(429, "PRIVATE_TEXT_RATE_LIMITED");
    nodes = walk(tree);
    input = nodes.find(
      (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
    );
    expect(input?.props.value).toBe(draft);

    tree = await submitWithFailure(403, "RESOURCE_UNAVAILABLE");
    nodes = walk(tree);
    expect(nodes.some((n) => n.props?.className === "chat-access-loss")).toBe(true);
    expect(
      nodes.some(
        (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
      ),
    ).toBe(false);
    expect(nodes.some((n) => n.props?.className === "composer-restricted")).toBe(true);

    // Restore ready + draft, then 401 access loss also clears draft.
    hooks.slots = [];
    hooks.cursor = 0;
    hooks.effects = [];
    hooks.cleanups = [];
    tree = await settleReady();
    nodes = walk(tree);
    input = nodes.find(
      (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
    );
    (input!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: draft },
    });
    tree = await submitWithFailure(401, "UNAUTHORIZED");
    nodes = walk(tree);
    expect(
      nodes.some(
        (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
      ),
    ).toBe(false);
    expect(nodes.some((n) => n.props?.["data-auth"] === "1" || n.props?.["data-profile-state"])).toBe(
      true,
    );

    // 404 path: draft cleared + private access loss surface.
    hooks.slots = [];
    hooks.cursor = 0;
    hooks.effects = [];
    hooks.cleanups = [];
    tree = await settleReady();
    nodes = walk(tree);
    input = nodes.find(
      (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
    );
    (input!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: draft },
    });
    tree = await submitWithFailure(404, "RESOURCE_UNAVAILABLE");
    nodes = walk(tree);
    expect(nodes.some((n) => n.props?.className === "chat-access-loss")).toBe(true);
    expect(
      nodes.some(
        (n) => n.type === "input" && n.props["aria-label"] === "Сообщение участникам",
      ),
    ).toBe(false);
  });
});
