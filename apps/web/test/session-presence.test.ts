import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, logout } from "../src/lib/api-client";
import { foregroundUpdates } from "../src/lib/foreground-updates";
import {
  SESSION_PRESENCE_ATTR,
  getSessionPresence,
  markSessionPresence,
  readDomSessionPresence,
  resetSessionPresenceForTests,
  sessionCookiePresenceFromStore,
  shouldSkipUnauthenticatedPrivateGet,
  type SessionPresence,
} from "../src/lib/session-presence";

function installDom() {
  const attrs = new Map<string, string>();
  const documentElement = {
    getAttribute(name: string) {
      return attrs.has(name) ? attrs.get(name)! : null;
    },
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
  };
  const windowTarget = new EventTarget();
  vi.stubGlobal("document", { documentElement });
  vi.stubGlobal("window", windowTarget);
  return { attrs, windowTarget };
}

function setDomPresence(value: string | null) {
  if (value == null) document.documentElement.removeAttribute(SESSION_PRESENCE_ATTR);
  else document.documentElement.setAttribute(SESSION_PRESENCE_ATTR, value);
}

beforeEach(() => {
  resetSessionPresenceForTests();
  foregroundUpdates.clear();
  installDom();
  setDomPresence(null);
});

afterEach(() => {
  resetSessionPresenceForTests();
  foregroundUpdates.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("session presence hint", () => {
  it("reads only present/absent from the DOM; missing/garbage is unknown", () => {
    expect(readDomSessionPresence()).toBe("unknown");
    setDomPresence("absent");
    expect(readDomSessionPresence()).toBe("absent");
    setDomPresence("present");
    expect(readDomSessionPresence()).toBe("present");
    setDomPresence("yes");
    expect(readDomSessionPresence()).toBe("unknown");
  });

  it("cookie store helper is presence-only and never returns a value", () => {
    expect(sessionCookiePresenceFromStore({ has: (n) => n === "__Host-gb_session" })).toBe("present");
    expect(sessionCookiePresenceFromStore({ has: () => false })).toBe("absent");
  });

  it("skips only exact GET /v1/me and /v1/me/push when hint is explicitly absent", () => {
    markSessionPresence("absent");
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me", "GET")).toBe(true);
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me/push", undefined)).toBe(true);
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me/push", "HEAD")).toBe(true);
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me/inbox/counts", "GET")).toBe(false);
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me/push/preference", "GET")).toBe(false);
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me", "POST")).toBe(false);
    markSessionPresence("present");
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me", "GET")).toBe(false);
    markSessionPresence("unknown");
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me", "GET")).toBe(false);
  });

  it("session-changed invalidates absence so login can fetch again; private-expired marks absent", () => {
    markSessionPresence("absent");
    expect(getSessionPresence()).toBe("absent");
    window.dispatchEvent(new Event("gb-session-changed"));
    expect(getSessionPresence()).toBe("unknown");
    window.dispatchEvent(new Event("gb-private-expired"));
    expect(getSessionPresence()).toBe("absent");
  });
});

describe("apiFetch session-presence transport", () => {
  it("absent trusted hint: no actual fetch for /v1/me or /v1/me/push; returns local ApiResult 401", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    markSessionPresence("absent");
    const me = await apiFetch("/v1/me");
    const push = await apiFetch("/v1/me/push");
    expect(me).toEqual({ ok: false, status: 401, error: "HTTP 401" });
    expect(push).toEqual({ ok: false, status: 401, error: "HTTP 401" });
    expect(fetchMock).not.toHaveBeenCalled();
    // Sibling private path still goes to the network.
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const counts = await apiFetch("/v1/me/inbox/counts");
    expect(counts.ok).toBe(false);
    expect(counts.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("present and unknown still perform a real fetch", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ id: "u" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    for (const state of ["present", "unknown"] as const) {
      fetchMock.mockClear();
      markSessionPresence(state);
      const result = await apiFetch<{ id: string }>("/v1/me");
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/me");
    }
  });

  it("after login session-changed, absent SSR hint no longer blocks /v1/me", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "u" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setDomPresence("absent");
    resetSessionPresenceForTests();
    expect(getSessionPresence()).toBe("absent");
    const blocked = await apiFetch("/v1/me");
    expect(blocked.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("gb-session-changed"));
    expect(getSessionPresence()).toBe("unknown");
    const allowed = await apiFetch<{ id: string }>("/v1/me");
    expect(allowed.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("missing DOM hint cannot falsely lock out a valid session", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "u" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setDomPresence(null);
    resetSessionPresenceForTests();
    expect(getSessionPresence()).toBe("unknown");
    const result = await apiFetch<{ id: string }>("/v1/me");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("logout presence fencing", () => {
  it("failed logout (500/network) keeps valid session eligible for /me; does not mark absent", async () => {
    markSessionPresence("present");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/v1/auth/logout")) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ id: "u" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const changed = vi.fn();
    window.addEventListener("gb-session-changed", changed);
    const result = await logout("csrf-test");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(changed).not.toHaveBeenCalled();
    expect(getSessionPresence()).toBe("present");
    expect(shouldSkipUnauthenticatedPrivateGet("/v1/me", "GET")).toBe(false);
    const me = await apiFetch<{ id: string }>("/v1/me");
    expect(me.ok).toBe(true);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/v1/me"))).toBe(true);
  });

  it("successful logout pins absent before consumers react — no post-event guest /me probe window", async () => {
    markSessionPresence("present");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const duringEvent: SessionPresence[] = [];
    window.addEventListener("gb-session-changed", () => {
      duringEvent.push(getSessionPresence());
      expect(shouldSkipUnauthenticatedPrivateGet("/v1/me", "GET")).toBe(true);
      expect(shouldSkipUnauthenticatedPrivateGet("/v1/me/push", "GET")).toBe(true);
    });
    const result = await logout("csrf-test");
    expect(result.ok).toBe(true);
    expect(duringEvent).toEqual(["absent"]);
    expect(getSessionPresence()).toBe("absent");
  });

  it("generic login gb-session-changed still invalidates SSR absent and allows real getMe", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "u" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setDomPresence("absent");
    resetSessionPresenceForTests();
    expect(getSessionPresence()).toBe("absent");
    window.dispatchEvent(new Event("gb-session-changed"));
    expect(getSessionPresence()).toBe("unknown");
    const allowed = await apiFetch<{ id: string }>("/v1/me");
    expect(allowed.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("notifySession:false does not mark absent; abort and stale generation do not publish", async () => {
    markSessionPresence("present");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const changed = vi.fn();
    window.addEventListener("gb-session-changed", changed);
    await logout("csrf-test", { notifySession: false });
    expect(changed).not.toHaveBeenCalled();
    expect(getSessionPresence()).toBe("present");

    markSessionPresence("present");
    const controller = new AbortController();
    let resolveLogout!: (response: Response) => void;
    const logoutResponse = new Promise<Response>(r => { resolveLogout = r; });
    vi.stubGlobal("fetch", vi.fn(() => logoutResponse));
    const pendingAbort = logout("csrf-test", { signal: controller.signal });
    controller.abort();
    resolveLogout(new Response(null, { status: 204 }));
    await pendingAbort;
    expect(changed).not.toHaveBeenCalled();
    expect(getSessionPresence()).toBe("present");

    // Stale generation: start logout as A, rotate to B before response — must not mark absent.
    markSessionPresence("present");
    foregroundUpdates.session("A:csrf-A");
    let resolveStale!: (response: Response) => void;
    const staleResponse = new Promise<Response>(r => { resolveStale = r; });
    vi.stubGlobal("fetch", vi.fn(() => staleResponse));
    const pendingStale = logout("csrf-A");
    foregroundUpdates.session("B:csrf-B");
    resolveStale(new Response(null, { status: 204 }));
    expect(await pendingStale).toMatchObject({ ok: true });
    expect(changed).not.toHaveBeenCalled();
    expect(getSessionPresence()).toBe("present");
  });

  it("401 logout is authoritative absent; private-expired still marks absent", async () => {
    markSessionPresence("present");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const during: string[] = [];
    window.addEventListener("gb-session-changed", () => during.push(getSessionPresence()));
    const result = await logout("csrf-test");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(during).toEqual(["absent"]);
    expect(getSessionPresence()).toBe("absent");

    markSessionPresence("present");
    window.dispatchEvent(new Event("gb-private-expired"));
    expect(getSessionPresence()).toBe("absent");
  });
});
