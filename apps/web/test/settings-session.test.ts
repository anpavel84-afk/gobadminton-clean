import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, logout } from "../src/lib/api-client";
import { foregroundUpdates } from "../src/lib/foreground-updates";

beforeEach(() => { vi.stubGlobal("window", new EventTarget()); foregroundUpdates.clear(); });
afterEach(() => { foregroundUpdates.clear(); vi.unstubAllGlobals(); });
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
};
describe("Settings session response ownership", () => {
  it.each(["B", "A-rotated", "expired"])("late logout cannot clear the %s session", async actor => {
    const response = deferred(), changed = vi.fn();
    window.addEventListener("gb-session-changed", changed);
    foregroundUpdates.session("A:csrf-A"); vi.stubGlobal("fetch", () => response.promise);
    const pending = logout("csrf-A");
    if (actor === "expired") foregroundUpdates.clear(); else foregroundUpdates.session(actor);
    response.resolve(new Response(null, { status: 204 }));
    expect(await pending).toMatchObject({ ok: true }); expect(changed).not.toHaveBeenCalled();
  });
  it("notifies for a current logout, while Settings can own the notification after fencing", async () => {
    const changed = vi.fn(); window.addEventListener("gb-session-changed", changed);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    await logout("csrf-A"); expect(changed).toHaveBeenCalledTimes(1);
    await logout("csrf-A", { notifySession: false }); expect(changed).toHaveBeenCalledTimes(1);
  });
  it("does not publish a session change for an aborted logout", async () => {
    const changed = vi.fn(); window.addEventListener("gb-session-changed", changed);
    const controller = new AbortController(), response = deferred();
    vi.stubGlobal("fetch", () => response.promise);
    const pending = logout("csrf-A", { signal: controller.signal }); controller.abort();
    response.resolve(new Response(null, { status: 204 })); await pending;
    expect(changed).not.toHaveBeenCalled();
  });
  it("actual current private 401 emits expiry once, without inventing expiry for 403/network errors", async () => {
    const expired = vi.fn(); window.addEventListener("gb-private-expired", expired);
    foregroundUpdates.session("A:csrf-A");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    await apiFetch("/v1/me"); expect(expired).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", async () => { throw Error("offline"); });
    await apiFetch("/v1/me"); expect(expired).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status: 401 }));
    await apiFetch("/v1/me"); await apiFetch("/v1/me"); expect(expired).toHaveBeenCalledTimes(1);
  });
  it("late account-A 401 cannot expire a newer same-account session", async () => {
    const expired = vi.fn(), response = deferred(); window.addEventListener("gb-private-expired", expired);
    foregroundUpdates.session("A:old"); vi.stubGlobal("fetch", () => response.promise);
    const pending = apiFetch("/v1/me"); foregroundUpdates.session("A:new");
    response.resolve(new Response(null, { status: 401 })); await pending;
    expect(expired).not.toHaveBeenCalled(); expect(foregroundUpdates.hasSession).toBe(true);
  });
});
