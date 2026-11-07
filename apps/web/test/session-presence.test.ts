import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../src/lib/api-client";
import {
  SESSION_PRESENCE_ATTR,
  getSessionPresence,
  markSessionPresence,
  readDomSessionPresence,
  resetSessionPresenceForTests,
  sessionCookiePresenceFromStore,
  shouldSkipUnauthenticatedPrivateGet,
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
  installDom();
  setDomPresence(null);
});

afterEach(() => {
  resetSessionPresenceForTests();
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
