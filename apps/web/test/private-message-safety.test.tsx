import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { socialError } from "../src/lib/messaging-presentation";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<(() => void) | undefined>,
}));

vi.mock("react", () => ({
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
}));
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../src/lib/api-client";
import { useSocialMutation } from "../src/components/consumer/messages/useSocialMutation";

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

describe("private message safety UX", () => {
  const success = vi.fn();
  const refresh = vi.fn();
  const storage = new Map<string, string>();

  function render(scope = "actor:game") {
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
    storage.clear();
    vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "shared-key" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
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
    const mutation = render();
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
    const mutation2 = render("actor:game2");
    mutation2.run("/v1/games/g/chat/messages", { text: "y", clientMessageId: "2" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledWith({
      status: 403,
      code: "RESOURCE_UNAVAILABLE",
    });
  });

  it("GameConversation retains draft only for PRIVATE_TEXT_* and clears on access loss", () => {
    const source = readFileSync(
      path.resolve(
        __dirname,
        "../src/components/consumer/messages/GameConversation.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(/PRIVATE_TEXT_CONTENT_REJECTED/);
    expect(source).toMatch(/PRIVATE_TEXT_RATE_LIMITED/);
    expect(source).toMatch(/retainDraft/);
    expect(source).toMatch(/status === 401/);
    expect(source).toMatch(/status === 403/);
    expect(source).toMatch(/status === 404/);
  });
});
