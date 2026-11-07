/**
 * Narrow server→DOM session *presence* hint for request eligibility only.
 * Never authentication, CSRF, or rights: cookie value is never read or exposed.
 * Missing/unknown hint must not lock out a valid session.
 */

export type SessionPresence = "absent" | "present" | "unknown";

/** Optional detail on `gb-session-changed` — logout can pin absent without a guest-probe window. */
export type SessionChangedDetail = {
  sessionPresence?: SessionPresence;
};

export const SESSION_COOKIE_NAME = "__Host-gb_session";
export const SESSION_PRESENCE_ATTR = "data-gb-session-presence";

/** Exact private GETs that may be skipped when the trusted hint is explicitly absent. */
const SKIPPABLE_ABSENT_GETS = new Set(["/v1/me", "/v1/me/push"]);

let clientOverride: SessionPresence | null = null;
let listenersInstalled = false;
/** Window the listeners/override are bound to — a replaced harness window drops stale override. */
let boundWindow: Window | null = null;

function normalizePresence(raw: string | null | undefined): SessionPresence {
  if (raw === "absent" || raw === "present") return raw;
  return "unknown";
}

/** Browser-only: read the SSR hint from the document element. */
export function readDomSessionPresence(): SessionPresence {
  if (typeof document === "undefined") return "unknown";
  return normalizePresence(document.documentElement.getAttribute(SESSION_PRESENCE_ATTR));
}

/**
 * Effective presence for eligibility checks.
 * Override (after login/logout/expiry) wins over the static SSR DOM hint.
 */
export function getSessionPresence(): SessionPresence {
  ensureSessionPresenceListeners();
  if (clientOverride) return clientOverride;
  return readDomSessionPresence();
}

/** Update client eligibility; mirrors onto the DOM attr when in a browser. */
export function markSessionPresence(next: SessionPresence): void {
  clientOverride = next;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute(SESSION_PRESENCE_ATTR, next);
  }
}

/**
 * Session change after login/account switch: do not freeze SSR absence.
 * Private expiry: treat as absent so guests stop probing.
 */
export function ensureSessionPresenceListeners(): void {
  if (typeof window === "undefined") return;
  // New browsing context / test harness window: drop override tied to the previous window.
  if (boundWindow !== window) {
    if (boundWindow !== null) clientOverride = null;
    listenersInstalled = false;
    boundWindow = window;
  }
  if (listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener("gb-session-changed", (event: Event) => {
    const detail = (event as CustomEvent<SessionChangedDetail | undefined>).detail;
    // Authoritative logout (or equivalent): keep/reinforce absent — no transient unknown probe window.
    if (detail?.sessionPresence === "absent") {
      markSessionPresence("absent");
      return;
    }
    // Login / account switch / generic notify: invalidate SSR absence so /me can run again.
    markSessionPresence("unknown");
  });
  window.addEventListener("gb-private-expired", () => {
    markSessionPresence("absent");
  });
}

/** Test/harness reset — restores override and listener gate. */
export function resetSessionPresenceForTests(): void {
  clientOverride = null;
  listenersInstalled = false;
  boundWindow = null;
}

export function pathWithoutQuery(path: string): string {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

/**
 * Skip only exact GET /v1/me and GET /v1/me/push when presence is explicitly absent.
 * present/unknown → real network (server still authenticates).
 */
export function shouldSkipUnauthenticatedPrivateGet(
  path: string,
  method: string | undefined,
): boolean {
  const verb = (method ?? "GET").toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return false;
  if (!SKIPPABLE_ABSENT_GETS.has(pathWithoutQuery(path))) return false;
  return getSessionPresence() === "absent";
}

/** Presence-only boolean from Next cookies(); never returns the cookie value. */
export function sessionCookiePresenceFromStore(store: {
  has(name: string): boolean;
}): "absent" | "present" {
  return store.has(SESSION_COOKIE_NAME) ? "present" : "absent";
}
