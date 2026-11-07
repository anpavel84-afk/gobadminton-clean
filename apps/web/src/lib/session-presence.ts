/**
 * Narrow server→DOM session *presence* hint for request eligibility only.
 * Never authentication, CSRF, or rights: cookie value is never read or exposed.
 * Missing/unknown hint must not lock out a valid session.
 */

export type SessionPresence = "absent" | "present" | "unknown";

export const SESSION_COOKIE_NAME = "__Host-gb_session";
export const SESSION_PRESENCE_ATTR = "data-gb-session-presence";

/** Exact private GETs that may be skipped when the trusted hint is explicitly absent. */
const SKIPPABLE_ABSENT_GETS = new Set(["/v1/me", "/v1/me/push"]);

let clientOverride: SessionPresence | null = null;
let listenersInstalled = false;

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
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("gb-session-changed", () => {
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
