import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../src/lib/api-client";
import { foregroundUpdates } from "../src/lib/foreground-updates";
import { privateViews } from "../src/lib/private-view";

const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
};
const unauthorized = () => new Response(null, { status: 401 });
beforeEach(() => { vi.stubGlobal("window", new EventTarget()); foregroundUpdates.clear(); });
afterEach(() => { foregroundUpdates.clear(); vi.unstubAllGlobals(); });

describe("actual auth 401 with private UI and no Inbox registration", () => {
  it("retires a view established while the identity refresh was pending", async () => {
    const response = deferred(), expired = vi.fn();
    window.addEventListener("gb-private-expired", expired);
    vi.stubGlobal("fetch", () => response.promise);
    const pending = apiFetch("/v1/me");
    privateViews.retain(privateViews.currentGeneration);
    expect(foregroundUpdates.hasSession).toBe(false);
    response.resolve(unauthorized());
    expect(await pending).toMatchObject({ ok: false, status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(privateViews.hasView(privateViews.currentGeneration)).toBe(false);
  });
  it("emits once for concurrent and later guest 401s, then permits valid relogin", async () => {
    const expired = vi.fn(), response = deferred();
    window.addEventListener("gb-private-expired", expired);
    privateViews.retain(privateViews.currentGeneration);
    vi.stubGlobal("fetch", () => response.promise);
    const pending = [apiFetch("/v1/me"), apiFetch("/v1/me/game-preferences")];
    response.resolve(unauthorized()); await Promise.all(pending);
    await apiFetch("/v1/me"); expect(expired).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("gb-session-changed"));
    privateViews.retain(privateViews.currentGeneration);
    await apiFetch("/v1/me"); expect(expired).toHaveBeenCalledTimes(2);
  });
  it.each(["B", "guest", "same-user-rotation"])("old 401 cannot retire the %s generation", async () => {
    const expired = vi.fn(), response = deferred();
    window.addEventListener("gb-private-expired", expired);
    privateViews.retain(privateViews.currentGeneration);
    vi.stubGlobal("fetch", () => response.promise);
    const pending = apiFetch("/v1/me");
    window.dispatchEvent(new Event("gb-session-changed"));
    privateViews.retain(privateViews.currentGeneration);
    response.resolve(unauthorized()); await pending;
    expect(expired).not.toHaveBeenCalled();
    expect(privateViews.hasView(privateViews.currentGeneration)).toBe(true);
  });
  it("fences a changed foreground actor even without a session event", async () => {
    const expired = vi.fn(), response = deferred();
    window.addEventListener("gb-private-expired", expired);
    foregroundUpdates.session("A:old"); privateViews.retain(privateViews.currentGeneration);
    vi.stubGlobal("fetch", () => response.promise);
    const pending = apiFetch("/v1/me"); foregroundUpdates.session("A:rotated");
    response.resolve(unauthorized()); await pending;
    expect(expired).not.toHaveBeenCalled(); expect(foregroundUpdates.hasSession).toBe(true);
  });
  it("drops retired view registration and cannot release a newer view by old cleanup", () => {
    const generation = privateViews.currentGeneration, release = privateViews.retain(generation)!;
    window.dispatchEvent(new Event("gb-session-changed"));
    expect(privateViews.retain(generation)).toBeUndefined();
    privateViews.retain(privateViews.currentGeneration); release();
    expect(privateViews.hasView(privateViews.currentGeneration)).toBe(true);
  });
  it("does not emit for the first anonymous 401 or a disposed private view", async () => {
    const expired = vi.fn(); window.addEventListener("gb-private-expired", expired);
    vi.stubGlobal("fetch", async () => unauthorized());
    await apiFetch("/v1/me");
    privateViews.retain(privateViews.currentGeneration)!(); await apiFetch("/v1/me");
    expect(expired).not.toHaveBeenCalled();
  });
  it.each(["/v1/games", "/v1/players", "/v1/auth/providers", "/v1/auth/logout"])("%s 401 does not globally retire private UI", async path => {
    const expired = vi.fn(); window.addEventListener("gb-private-expired", expired);
    foregroundUpdates.session("A:csrf"); privateViews.retain(privateViews.currentGeneration);
    vi.stubGlobal("fetch", async () => unauthorized());
    await apiFetch(path); expect(expired).not.toHaveBeenCalled();
  });
  it.each([403, 408, 409, 429, 503])("HTTP %s does not become expiry", async status => {
    const expired = vi.fn(); window.addEventListener("gb-private-expired", expired);
    privateViews.retain(privateViews.currentGeneration);
    vi.stubGlobal("fetch", async () => new Response(null, { status }));
    await apiFetch("/v1/me"); expect(expired).not.toHaveBeenCalled();
  });
  it("keeps offline/aborted responses from retiring private UI", async () => {
    const expired = vi.fn(); window.addEventListener("gb-private-expired", expired);
    privateViews.retain(privateViews.currentGeneration);
    vi.stubGlobal("fetch", async () => { throw Error("offline"); });
    await apiFetch("/v1/me");
    const response = deferred(), controller = new AbortController();
    vi.stubGlobal("fetch", () => response.promise);
    const pending = apiFetch("/v1/me", { signal: controller.signal }); controller.abort();
    response.resolve(unauthorized()); await pending; expect(expired).not.toHaveBeenCalled();
  });
});
