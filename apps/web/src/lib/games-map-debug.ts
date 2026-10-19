/** Local, opt-in diagnostics. Never pass identifiers, camera data or raw errors. */
export type MapLogEntry = { t: number; ev: string; detail: string | number };
const entries: MapLogEntry[] = [];
const listeners = new Set<() => void>();
declare global { interface Window { __gbMapLog?: MapLogEntry[] } }
export function mapDebugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location?.search).get("mapdebug") === "1") {
      try { sessionStorage.setItem("gb-games-map-debug", "1"); } catch { /* Optional. */ }
      return true;
    }
    return sessionStorage.getItem("gb-games-map-debug") === "1";
  } catch { return false; }
}
export function mapLogEntries() { return entries.slice(); }
export function subscribeMapLog(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function logMapEvent(ev: string, detail: string | number = "") {
  if (!mapDebugEnabled()) return;
  // Reject queries and decimal coordinate pairs rather than trying to redact secrets.
  const safe = typeof detail === "number" ? (Number.isFinite(detail) ? detail : "invalid")
    : /[?#]|https?:|[-+]?\d{1,3}\.\d+\s*[, ]\s*[-+]?\d{1,3}\.\d+/.test(detail) ? "redacted" : detail.slice(0, 160);
  const entry = { t: Date.now(), ev: ev.replace(/[^a-z0-9-]/gi, "").slice(0, 48), detail: safe };
  entries.push(entry); if (entries.length > 200) entries.shift();
  window.__gbMapLog = entries;
  console.info("[games-map-life]", entry);
  listeners.forEach(listener => listener());
}
