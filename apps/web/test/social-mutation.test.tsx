import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
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
  useEffect(effect: () => unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = true;
      effect();
    }
  },
}));
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../src/lib/api-client";
import { useSocialMutation } from "../src/components/consumer/messages/useSocialMutation";

describe("useSocialMutation validateSuccess pending identity", () => {
  const success = vi.fn();
  const refresh = vi.fn();
  const storage = new Map<string, string>();
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    hooks.slots = [];
    hooks.cursor = 0;
    storage.clear();
    vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "shared-key" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("passes frozen pending as optional second arg without breaking single-arg validators", async () => {
    const seen: unknown[] = [];
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    hooks.cursor = 0;
    const mutation = useSocialMutation<{ ok: boolean }>(
      "actor:probe",
      "csrf",
      success,
      refresh,
      true,
      {
        validateSuccess: (data, pending) => {
          seen.push({ data, pending });
          return data.ok === true && pending?.key === "shared-key";
        },
      },
    );
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
    hooks.cursor = 0;
    const mutation = useSocialMutation<{ ok: boolean }>(
      "actor:legacy",
      "csrf",
      success,
      refresh,
      true,
      { validateSuccess: (data) => data.ok === true },
    );
    mutation.run("/v1/legacy", { y: 2 });
    await settle();
    expect(success).toHaveBeenCalledOnce();
    expect(storage.get("gb-fr04-pending:actor:legacy")).toBeUndefined();
  });
});
