/** Public diagnostics deliberately contain no messages, query strings or credentials. */
export type MapErrorKind = "style" | "style-identity" | "origin" | "webgl" | "init" | "tiles" | "glyph" | "sprite" | "geojson" | "timeout" | "other";
export type MapDiagnostic = { kind: MapErrorKind; fatal: boolean; url?: string; status?: number };
export type MapDiagnosticContext = { phase?: "style" | "init"; firstRender?: boolean; loadedTiles: number; sinceLoadMs?: number };
export function classifyMapError(event: unknown, ctx: MapDiagnosticContext): MapDiagnostic {
  const outer = (event && typeof event === "object" ? event : {}) as Record<string, unknown>;
  const error = (outer.error && typeof outer.error === "object" ? outer.error : outer) as Record<string, unknown>;
  const message = String(error.message ?? (typeof event === "string" ? event : "")).toLowerCase();
  const raw = outer.url ?? error.url ?? (outer.tile as { request?: { url?: string } } | undefined)?.request?.url;
  let url: string | undefined;
  if (typeof raw === "string") {
    try { url = new URL(raw.replace(/^pmtiles:\/\//, ""), "https://map.invalid").pathname; } catch { /* Omit malformed URLs. */ }
  }
  const path = (url ?? "").toLowerCase();
  const explicit = outer.kind as MapErrorKind | undefined;
  const kinds: MapErrorKind[] = ["style", "style-identity", "origin", "webgl", "init", "tiles", "glyph", "sprite", "geojson", "timeout", "other"];
  const kind: MapErrorKind = explicit && kinds.includes(explicit) ? explicit
    : /style identity|style-identity/.test(message) ? "style-identity"
    : /origin|unapproved/.test(message) ? "origin"
    : /webgl|context lost/.test(message) ? "webgl"
    : /timeout|timed out/.test(message) ? "timeout"
    : /style/.test(message) || /style[^/]*\.json$/.test(path) ? "style"
    : /glyph/.test(path + " " + message) || /\.pbf$/.test(path) ? "glyph"
    : /sprite/.test(path + " " + message) ? "sprite"
    : /geojson/.test(path + " " + message) ? "geojson"
    : outer.sourceId === "protomaps" || /pmtiles|tile/.test(path + " " + message) ? "tiles"
    : ctx.phase ?? "other";
  const status = outer.status ?? error.status;
  return { kind, fatal: ["style", "style-identity", "origin", "webgl", "init", "timeout"].includes(kind) ||
    (kind === "tiles" && ctx.loadedTiles === 0 && (ctx.sinceLoadMs ?? 0) >= 8000),
    ...(url ? { url } : {}), ...(typeof status === "number" ? { status } : {}) };
}
export const mapErrorReason: Record<MapErrorKind, string> = {
  style: "Не удалось загрузить оформление карты.", "style-identity": "Не удалось подтвердить версию карты.",
  origin: "Ресурс карты недоступен по разрешённому адресу.", webgl: "Браузер не смог отобразить карту.",
  init: "Не удалось запустить карту.", tiles: "Не удалось загрузить улицы и объекты карты.",
  glyph: "Не удалось загрузить подписи карты.", sprite: "Не удалось загрузить значки карты.",
  geojson: "Не удалось загрузить объекты карты.", timeout: "Карта не ответила вовремя.", other: "Не удалось отобразить карту.",
};
