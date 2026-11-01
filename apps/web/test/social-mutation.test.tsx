import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
          typeof value === "function" ? (value as (previous: T) => T)(hooks.slots[index] as T) : value;
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
import {
  useSocialMutation,
  type SocialMutationOptions,
} from "../src/components/consumer/messages/useSocialMutation";

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

type Probe = { ok: boolean };

describe("useSocialMutation validateSuccess pending identity", () => {
  const success = vi.fn();
  const refresh = vi.fn();
  const storage = new Map<string, string>();
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  function render(scope: string, options?: SocialMutationOptions<Probe>, csrf = "csrf") {
    hooks.cursor = 0;
    useSocialMutation<Probe>(scope, csrf, success, refresh, true, options);
    flushEffects();
    hooks.cursor = 0;
    return useSocialMutation<Probe>(scope, csrf, success, refresh, true, options);
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

  it("passes frozen pending as optional second arg without breaking single-arg validators", async () => {
    const seen: unknown[] = [];
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    const mutation = render("actor:probe", {
      validateSuccess: (data, pending) => {
        seen.push({ data, pending });
        return data.ok === true && pending?.key === "shared-key";
      },
    });
    mutation.run("/v1/probe", { x: 1 }, "POST");
    await settle();
    expect(seen[0]).toMatchObject({
      data: { ok: true },
      pending: { path: "/v1/probe", key: "shared-key", method: "POST" },
    });
    expect(success).toHaveBeenCalledOnce();
  });

  it("old single-arg validateSuccess callers still clear pending on true", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    const mutation = render("actor:legacy", { validateSuccess: (data) => data.ok === true });
    mutation.run("/v1/legacy", { y: 2 });
    await settle();
    expect(success).toHaveBeenCalledOnce();
    expect(storage.get("gb-fr04-pending:actor:legacy")).toBeUndefined();
  });

  it("scope change without marker clears in-memory pending; late prior response does not settle", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(apiFetch)
      .mockImplementationOnce(() => first as Promise<never>)
      .mockResolvedValueOnce({ ok: true, status: 200, data: { ok: true } });

    let mutation = render("actor:a");
    expect(mutation.run("/v1/a", { n: 1 })).toBe(true);

    mutation = render("actor:b");
    expect(mutation.pending).toBe(false);
    expect(mutation.run("/v1/b", { n: 2 })).toBe(true);
    await settle();
    expect(success).toHaveBeenCalledOnce();
    expect(storage.get("gb-fr04-pending:actor:b")).toBeUndefined();

    resolveFirst({ ok: true, status: 200, data: { ok: true } });
    await settle();
    expect(success).toHaveBeenCalledOnce();
    expect(storage.get("gb-fr04-pending:actor:a")).toContain("shared-key");
  });

  it("validatePending HOLD keeps marker and blocks retry", async () => {
    storage.set(
      "gb-fr04-pending:actor:hold",
      JSON.stringify({ path: "/v1/bad", body: {}, key: "held-key", method: "POST" }),
    );
    const mutation = render("actor:hold", {
      validatePending: (pending) => pending.path === "/v1/good",
    });
    expect(mutation.pending).toBe(true);
    expect(mutation.code).toBe("hold");
    mutation.retry();
    await settle();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(storage.get("gb-fr04-pending:actor:hold")).toContain("held-key");
  });
});
