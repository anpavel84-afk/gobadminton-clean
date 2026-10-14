import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Deterministic hook scheduler: retain state/ref slots across explicit renders.
// Transport and callbacks are real hook behavior; no browser or automatic timers.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", () => ({
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: T | ((previous: T) => T)) => {
      hooks.slots[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks.slots[index] as T) : value;
    }];
  },
  useRef<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect(effect: () => unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) { hooks.slots[index] = true; effect(); }
  },
}));
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../src/lib/api-client";
import { useSocialMutation } from "../src/components/consumer/messages/useSocialMutation";
const success = vi.fn(), refresh = vi.fn();
const storage = new Map<string, string>();
function render() { hooks.cursor = 0; return useSocialMutation("actor:friends:peer", "csrf", success, refresh); }
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; storage.clear(); vi.resetAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "same-attempt-key" });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
describe("Friends reuse of social mutation retry boundary", () => {
  it.each([0, 503])("unknown outcome %i locks new actions and only explicit retry keeps identical key/body", async status => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: false, status, error: "unknown" }).mockResolvedValueOnce({ ok: true, status: 201, data: {} });
    const mutation = render();
    mutation.run("/v1/friend-requests", { targetPublicPlayerId: "peer" });
    mutation.run("/v1/friend-requests", { targetPublicPlayerId: "other-peer" });
    await settle();
    expect(apiFetch).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
    const pending = render(); expect(pending.pending).toBe(true);
    pending.run("/v1/friend-requests", { targetPublicPlayerId: "other-peer" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    pending.retry(); await settle();
    expect(vi.mocked(apiFetch).mock.calls[1]).toEqual(vi.mocked(apiFetch).mock.calls[0]);
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toMatchObject({ csrfToken: "csrf", headers: { "Idempotency-Key": "same-attempt-key" } });
    expect(success).toHaveBeenCalledOnce(); expect(render().pending).toBe(false);
  });
  it.each([401, 409, 403, 404])("known failure %i refreshes authorization/state without replay or success", async status => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status, error: "denied" });
    render().run("/v1/friend-requests/request-id/accept", { expectedVersion: "9007199254740993" }); await settle();
    expect(refresh).toHaveBeenCalledOnce(); expect(success).not.toHaveBeenCalled();
    const result = render(); expect(result.pending).toBe(false); result.retry(); await settle();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
  it("restored unresolved attempt never sends until explicit retry", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 0, error: "unknown" });
    render().run("/v1/friend-requests", { targetPublicPlayerId: "peer" }); await settle();
    hooks.slots = []; render();
    const restored = render(); expect(restored.pending).toBe(true); expect(apiFetch).toHaveBeenCalledTimes(1);
    restored.retry(); await settle();
    expect(vi.mocked(apiFetch).mock.calls[1]).toEqual(vi.mocked(apiFetch).mock.calls[0]);
  });
});
