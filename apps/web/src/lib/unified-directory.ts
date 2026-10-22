import type { UnifiedCapability, UnifiedFilters, UnifiedMapSnapshot, UnifiedOriginInput, UnifiedPreview, UnifiedRow, UnifiedSnapshot, UnifiedDistance } from "@gobadminton/contracts";
import { apiFetch, type ApiResult } from "./api-client";
import type { Me, PublicPlayer } from "./consumer-types";

export type ScopedCatalogCursor = { scope: string; value: string };
/** Pagination tokens belong to one exact ordinary filter scope. */
export function scopedCatalogCursor(cursor: ScopedCatalogCursor | null, scope: string): string | null {
  return cursor?.scope === scope ? cursor.value : null;
}
export const UNIFIED_WIRE = "players-unified-radar-v1" as const;
export type RadarConfig = {
  devMoscowTest?: { latitude: number; longitude: number; accuracyMeters: number };
  exposureMode: "live" | "synthetic_demo";
  unifiedDirectory: UnifiedCapability;
  publishingV2: { enabled: boolean };
  cities: Array<{ cityId: string; regionId: string; map: { availability: string; mapId?: string | null; version?: string | null } }>;
};
/** A successful HTTP response alone does not advertise a usable private capability. */
export function compatibleRadarConfig(value: unknown): RadarConfig | null {
  if (!value || typeof value !== "object") return null;
  const config = value as RadarConfig;
  if ((config.exposureMode !== "live" && config.exposureMode !== "synthetic_demo") ||
      config.unifiedDirectory?.contractVersion !== UNIFIED_WIRE ||
      typeof config.unifiedDirectory.enabled !== "boolean" ||
      typeof config.unifiedDirectory.disclosure?.text !== "string" ||
      typeof config.publishingV2?.enabled !== "boolean" ||
      !Array.isArray(config.cities) || config.cities.some(city => !city || typeof city.cityId !== "string" || typeof city.regionId !== "string" || typeof city.map?.availability !== "string")) return null;
  return config;
}
export function unifiedDirectoryAvailable(config: RadarConfig | null, view: Pick<DirectoryView, "capabilityUnavailable">) {
  return compatibleRadarConfig(config)?.unifiedDirectory.enabled === true && !view.capabilityUnavailable;
}
export function distanceText(distance: UnifiedDistance | null): string | null {
  if (!distance) return null;
  const units = (m: number) => m < 1000 ? `${m} м` : `${(m / 1000).toLocaleString("ru-RU", { maximumFractionDigits: distance.roundingStepMeters < 1000 ? 1 : 0 })} км`;
  return distance.kind === "range" ? `Рядом · до ${units(distance.upperMeters)} (примерно)` : `≈ ${units(distance.roundedMeters)}`;
}
export function distanceExplanation(row: UnifiedRow): string {
  const radar = row.radar;
  if (!radar) return "";
  return `Приблизительное положение; погрешность ${radar.distance?.uncertaintyMeters ?? radar.geo.uncertaintyMeters} м. Возраст геопозиции: до ${radar.geo.sourceAgeSeconds} с.${radar.geo.quality === "degraded" ? " Местоположение определяется неточно." : ""}`;
}
export type DirectoryView = {
  mode: "ordinary" | "unified";
  snapshot: UnifiedSnapshot | null;
  rows: UnifiedRow[];
  pins: UnifiedRow[];
  mapPage: UnifiedMapSnapshot["mapPage"] | null;
  selected: string | null;
  preview: UnifiedPreview | null;
  busy: boolean;
  previewBusy: boolean;
  previewError: string;
  notice: string;
  stale: boolean;
  capabilityUnavailable: boolean;
  authenticationRequired: boolean;
};
/** Overlay only live private Radar rows; the public API remains catalog authority.
 * The existing More boundary precedes the remainder until all Radar ranks load.
 */
export function mergeRadarCatalog(players: PublicPlayer[], view: DirectoryView, authorized: boolean, now = Date.now()) {
  const live = authorized && view.mode === "unified" && !view.stale && !view.authenticationRequired && !view.capabilityUnavailable &&
    view.snapshot !== null && Date.parse(view.snapshot.validUntil) > now;
  const seen = new Set<string>();
  const radar = live ? view.rows.filter(row => {
    if (!row.radar || Date.parse(row.radar.validUntil) <= now || seen.has(row.publicPlayerId)) return false;
    seen.add(row.publicPlayerId); return true;
  }) : [];
  const loadedRadar = live ? new Set(view.rows.filter(row => row.radar !== null).map(row => row.publicPlayerId)).size : 0;
  const moreRadar = Boolean(live && view.snapshot?.page.nextCursor && loadedRadar < view.snapshot.totals.radarTotal);
  const ordinary = players.filter(player => {
    if (seen.has(player.publicPlayerId)) return false;
    seen.add(player.publicPlayerId); return true;
  });
  // The owner requires the ordinary catalog to stay present even when Radar
  // has another page. Show its existing rows after the bounded Radar window,
  // with an explicit More boundary before them; never hide other cities.
  return { radar, ordinary, moreRadar };
}
/** Admission and render fence for the whole private schedule, including malformed
 * successful responses. No missing/invalid deadline is treated as an infinite TTL.
 */
export function liveUnifiedPreview(data: UnifiedPreview | null, playerId: string, now: number): data is UnifiedPreview {
  const closed = (value: unknown, required: string[], optional: string[] = []) =>
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
  const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const nonnegative = (value: number) => Number.isInteger(value) && value >= 0;
  const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const nullableUrl = (value: unknown) => value === null || typeof value === "string";
  if (!data || !closed(data, ["player", "proximityBand", "radar", "upcomingGames"]) || data.proximityBand !== null ||
      !closed(data.player, ["publicPlayerId", "displayName", "level", "trainer"], ["avatar", "canRequestContact"]) ||
      !uuid(data.player.publicPlayerId) || data.player.publicPlayerId !== playerId || typeof data.player.displayName !== "string" ||
      typeof data.player.trainer !== "boolean" ||
      (data.player.canRequestContact !== undefined && typeof data.player.canRequestContact !== "boolean")) return false;
  const level = data.player.level;
  if (level !== null && (!closed(level, ["scaleId", "scaleVersion", "levelId", "provenance"]) ||
      typeof level.scaleId !== "string" || typeof level.levelId !== "string" ||
      !Number.isInteger(level.scaleVersion) || level.provenance !== "self_declared")) return false;
  const avatar = data.player.avatar;
  if (avatar !== undefined && (!closed(avatar, ["uploadedUrl", "providerUrl"]) ||
      !nullableUrl(avatar.uploadedUrl) || !nullableUrl(avatar.providerUrl))) return false;
  if (!closed(data.radar, ["consentPolicyVersion", "geo", "validUntil", "distance"]) ||
      data.radar.consentPolicyVersion !== "radar-geographic-sharing-v2" ||
      !instant(data.radar.validUntil) || Date.parse(data.radar.validUntil) <= now) return false;
  const geo = data.radar.geo;
  if (!closed(geo, ["latitude", "longitude", "crs", "model", "gridSizeMeters", "uncertaintyMeters", "quality", "sourceTimestampBucket", "sourceAgeSeconds"]) ||
      !Number.isFinite(geo.latitude) || geo.latitude < -90 || geo.latitude > 90 ||
      !Number.isFinite(geo.longitude) || geo.longitude < -180 || geo.longitude > 180 || geo.crs !== "EPSG:4326" ||
      !["regional_grid_100m_v1", "regional_grid_1000m_v1"].includes(geo.model) ||
      geo.gridSizeMeters !== (geo.model === "regional_grid_100m_v1" ? 100 : 1000) ||
      !nonnegative(geo.uncertaintyMeters) || !nonnegative(geo.sourceAgeSeconds) ||
      !instant(geo.sourceTimestampBucket) || !["approximate", "degraded"].includes(geo.quality)) return false;
  const distance = data.radar.distance;
  if (distance !== null && (!closed(distance, ["kind", "roundedMeters", "roundingStepMeters", "uncertaintyMeters", "lowerMeters", "upperMeters", "basis", "approximate"]) ||
      ![100, 500, 1000].includes(distance.roundingStepMeters) || !nonnegative(distance.uncertaintyMeters) ||
      distance.basis !== "published_centers_geodesic" || distance.approximate !== true ||
      (distance.kind === "estimate" ? !nonnegative(distance.roundedMeters) || distance.lowerMeters !== null || distance.upperMeters !== null :
        distance.kind !== "range" || distance.roundedMeters !== null || distance.lowerMeters !== 0 || !nonnegative(distance.upperMeters)))) return false;
  if (!Array.isArray(data.upcomingGames) || data.upcomingGames.length > 3) return false;
  const ids = new Set<string>();
  let previous = "";
  return data.upcomingGames.every(game => {
    if (!closed(game, ["id", "title", "activityKind", "startsAt", "endsAt", "timezone", "cover", "venue"]) ||
        !uuid(game.id) || ids.has(game.id) || typeof game.title !== "string" ||
        !["regular", "trainer_led"].includes(game.activityKind) || !instant(game.startsAt) || !instant(game.endsAt) ||
        Date.parse(game.startsAt) <= now || Date.parse(game.endsAt) <= Date.parse(game.startsAt) || typeof game.timezone !== "string" ||
        !closed(game.venue, ["name", "cover"]) || typeof game.venue.name !== "string" ||
        !closed(game.cover, ["uploadedUrl"]) || !closed(game.venue.cover, ["uploadedUrl"]) ||
        !nullableUrl(game.cover.uploadedUrl) || !nullableUrl(game.venue.cover.uploadedUrl)) return false;
    try { new Intl.DateTimeFormat("ru-RU", { timeZone: game.timezone }); } catch { return false; }
    const order = `${new Date(game.startsAt).toISOString()}:${game.id}`;
    if (previous && order < previous) return false;
    previous = order; ids.add(game.id); return true;
  });
}
const initial = (): DirectoryView => ({ mode: "ordinary", snapshot: null, rows: [], pins: [], mapPage: null, selected: null, preview: null, busy: false, previewBusy: false, previewError: "", notice: "", stale: false, capabilityUnavailable: false, authenticationRequired: false });
/** Private contexts/proofs/origins live only in this root-client session, never URLs/storage. */
export class UnifiedDirectoryController {
  view = initial();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private selectionEpoch = 0;
  private selectionAbort = new AbortController();
  private abort = new AbortController();
  private me: Me | null = null;
  private visible = true;
  private filters: UnifiedFilters | null = null;
  private origin: UnifiedOriginInput = { kind: "none" };
  private nextInitial = 0;
  private retryAt = 0;
  private pending = false;
  private activationOriginKey: string | null = null;
  matches(filters: UnifiedFilters, activationKey: string | null) { return Boolean(this.view.snapshot && Date.parse(this.view.snapshot.validUntil) > this.clock() && JSON.stringify(this.filters) === JSON.stringify(filters) && this.activationOriginKey === activationKey); }
  camera: { center: [number, number]; zoom: number } | null = null;
  scrollY = 0;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.view;
  constructor(private request = apiFetch, private clock = Date.now) {}
  private set(patch: Partial<DirectoryView>) { this.view = { ...this.view, ...patch }; this.listeners.forEach(fn => fn()); }
  private invalidate(notice = "", stale = false) {
    ++this.epoch; ++this.selectionEpoch; this.selectionAbort.abort(); this.abort.abort(); this.abort = new AbortController(); this.pending = false;
    this.set({ snapshot: null, rows: [], pins: [], mapPage: null, selected: null, preview: null, busy: false, previewBusy: false, previewError: "", notice, stale });
  }
  bind(me: Me | null) {
    if (this.me?.id === me?.id && this.me?.csrfToken === me?.csrfToken) return;
    // A feature's 401 remains meaningful when /me succeeds for the same actor.
    const authenticationRequired = this.view.authenticationRequired && this.me?.id === me?.id && me !== null;
    this.me = me; this.origin = { kind: "none" }; this.filters = null; this.nextInitial = 0; this.retryAt = 0; this.camera = null; this.scrollY = 0;
    this.invalidate(authenticationRequired ? "Войдите снова, чтобы смотреть участников Radar." : "", authenticationRequired); this.set({ mode: "ordinary", capabilityUnavailable: false, authenticationRequired });
  }
  ordinary() { if (this.view.authenticationRequired) return; this.origin = { kind: "none" }; this.invalidate(); this.set({ mode: "ordinary" }); }
  visibility(visible: boolean) {
    this.visible = visible;
    if (!visible && !this.view.authenticationRequired) { this.origin = { kind: "none" }; this.invalidate("Вернитесь к списку и обновите участников Radar.", true); }
  }
  private valid(epoch: number) { return epoch === this.epoch && this.visible && this.me !== null; }
  private fail(result: Exclude<ApiResult<unknown>, { ok: true }>) {
    if (result.status === 404) {
      this.origin = { kind: "none" }; this.activationOriginKey = null; this.camera = null; this.scrollY = 0;
      this.invalidate("Участники Radar сейчас недоступны. Можно пользоваться обычным каталогом.");
      this.set({ mode: "ordinary", capabilityUnavailable: true }); return;
    }
    if (result.status === 429) this.retryAt = this.clock() + (result.retryAfterSeconds ?? 60) * 1000;
    this.origin = { kind: "none" };
    this.invalidate(result.status === 401 ? "Войдите снова, чтобы смотреть участников Radar." : result.status === 403 ? "Нет доступа к участникам Radar. Можно смотреть обычный каталог." : result.status === 429 ? "Попробуйте обновить список немного позже." : result.status === 409 || result.status === 410 ? "Список изменился. Обновите участников Radar." : result.status === 422 ? "Radar недоступен для выбранного города или геопозиции. Можно смотреть обычный каталог." : "Не удалось загрузить участников Radar. Попробуйте снова.", true);
    if (result.status === 401) this.set({ mode: "ordinary", authenticationRequired: true });
  }
  tick() {
    const now = this.clock();
    const snapshotExpired = this.view.snapshot && (!Number.isFinite(Date.parse(this.view.snapshot.validUntil)) || now >= Date.parse(this.view.snapshot.validUntil));
    // Target proof/lease may expire sooner than the enclosing 45-second
    // private query. Never retain its selection, preview or map pins after TTL.
    const rowExpired = [...this.view.rows, ...this.view.pins].some(row =>
      row.radar && (!Number.isFinite(Date.parse(row.radar.validUntil)) || Date.parse(row.radar.validUntil) <= now));
    const previewExpired = this.view.preview &&
      !liveUnifiedPreview(this.view.preview, this.view.selected ?? "", now);
    if (snapshotExpired || rowExpired || previewExpired) {
      this.origin = { kind: "none" };
      this.invalidate("Список участников Radar устарел. Обновляем данные.", true);
      this.set({ mode: "ordinary" });
    }
  }
  async query(filters: UnifiedFilters, origin: UnifiedOriginInput = { kind: "none" }, activationKey: string | null = origin.kind === "current_activation" ? origin.activationId : null) {
    if (!this.me || !this.visible || this.view.capabilityUnavailable || this.view.authenticationRequired) return;
    const changed = JSON.stringify(this.filters) !== JSON.stringify(filters) ||
      this.activationOriginKey !== activationKey;
    // A filter/activation change aborts and fences the old in-flight response.
    if (this.pending) {
      if (!changed) return;
      this.invalidate();
      this.set({ mode: "ordinary" });
    }
    if (this.clock() < Math.max(this.nextInitial, this.retryAt)) {
      if (changed) { this.invalidate(); this.set({ mode: "ordinary" }); }
      // Never retain a raw foreground fix while waiting for the cooldown.
      this.origin = { kind: "none" };
      this.set({ stale: true, notice: "Обновить участников Radar можно через несколько секунд. Пока доступен обычный каталог." }); return;
    }
    this.filters = filters; this.origin = origin; this.activationOriginKey = activationKey;
    this.invalidate(); this.set({ mode: "unified" });
    this.nextInitial = this.clock() + 30000;
    const epoch = this.epoch; this.pending = true; this.set({ busy: true });
    const result = await this.request<UnifiedSnapshot>("/v1/players/query", { method: "POST", csrfToken: this.me.csrfToken, signal: this.abort.signal, body: JSON.stringify({ contractVersion: UNIFIED_WIRE, filters, origin, limit: 50 }) });
    if (!this.valid(epoch)) return;
    this.pending = false; this.set({ busy: false });
    if (!result.ok) { this.fail(result); return; }
    if (!this.acceptable(result.data)) { this.invalidate("Список устарел. Обновите участников Radar.", true); return; }
    // Never retain the transient raw foreground input once the server issued a private reference.
    this.origin = result.data.query.originRef ? { kind: "reference", originRef: result.data.query.originRef } : { kind: "none" };
    this.set({ snapshot: result.data, rows: result.data.items, notice: result.data.query.originState === "none" ? "Участники Radar по городу. Расстояние неизвестно." : "Расстояние приблизительное, по опубликованным геопозициям." });
  }
  private acceptable(data: UnifiedSnapshot | UnifiedMapSnapshot) {
    const now = this.clock();
    // A queryRef can outlive an individual participant's Radar lease. Refuse
    // entire late response before admitting even one expired private marker.
    return data.contractVersion === UNIFIED_WIRE &&
      data.cityId === this.filters?.cityId &&
      Number.isFinite(Date.parse(data.validUntil)) && Date.parse(data.validUntil) > now &&
      data.items.every(row => !row.radar ||
        (Number.isFinite(Date.parse(row.radar.validUntil)) && Date.parse(row.radar.validUntil) > now));
  }
  async refresh() { if (this.filters && !this.pending) await this.query(this.filters, this.origin, this.activationOriginKey); }
  async more() {
    const snapshot = this.view.snapshot, me = this.me;
    if (!snapshot?.page.nextCursor || !me || this.pending) return;
    this.tick(); if (!this.view.snapshot) return;
    const epoch = this.epoch; this.pending = true; this.set({ busy: true });
    const r = await this.request<UnifiedSnapshot>("/v1/players/query", { method: "POST", csrfToken: me.csrfToken, signal: this.abort.signal, body: JSON.stringify({ contractVersion: UNIFIED_WIRE, queryRef: snapshot.query.queryRef, cursor: snapshot.page.nextCursor, limit: 50 }) });
    if (!this.valid(epoch)) return;
    this.pending = false; this.set({ busy: false });
    if (!r.ok) { this.fail(r); return; }
    if (!this.acceptable(r.data) || r.data.query.queryRef !== snapshot.query.queryRef) { this.invalidate("Список изменился. Обновите участников Radar.", true); return; }
    this.set({ snapshot: r.data, rows: [...this.view.rows, ...r.data.items.filter(row => !this.view.rows.some(old => old.publicPlayerId === row.publicPlayerId))] });
  }
  async map(next = false) {
    const snapshot = this.view.snapshot, me = this.me;
    if (!snapshot || !me || this.pending || (next && !this.view.mapPage?.nextMapCursor)) return;
    this.tick(); if (!this.view.snapshot) return;
    this.close();
    const epoch = this.epoch; this.pending = true; this.set({ busy: true });
    const r = await this.request<UnifiedMapSnapshot>("/v1/players/query/map", { method: "POST", csrfToken: me.csrfToken, signal: this.abort.signal, body: JSON.stringify({ contractVersion: UNIFIED_WIRE, queryRef: snapshot.query.queryRef, ...(next ? { mapCursor: this.view.mapPage!.nextMapCursor } : {}), limit: 100 }) });
    if (!this.valid(epoch)) return;
    this.pending = false; this.set({ busy: false });
    if (!r.ok) { this.fail(r); return; }
    if (!this.acceptable(r.data) || r.data.query.queryRef !== snapshot.query.queryRef) { this.invalidate("Список изменился. Обновите участников Radar.", true); return; }
    ++this.selectionEpoch;
    // Replace the map window; never silently accumulate/export the entire city.
    this.set({ pins: r.data.items.filter(row => row.radar !== null).slice(0, 200), mapPage: r.data.mapPage, selected: null, preview: null, previewBusy: false, previewError: "" });
  }
  close() { ++this.selectionEpoch; this.selectionAbort.abort(); this.set({ selected: null, preview: null, previewBusy: false, previewError: "" }); }
  async select(row: UnifiedRow) {
    if (!row.radar || !this.me || this.pending || this.clock() < this.retryAt) return;
    this.tick(); if (!this.view.snapshot || ![...this.view.pins, ...this.view.rows].includes(row)) return;
    this.selectionAbort.abort(); this.selectionAbort = new AbortController();
    const epoch = this.epoch, selection = ++this.selectionEpoch;
    this.set({ selected: row.publicPlayerId, preview: null, previewBusy: true, previewError: "" });
    const r = await this.request<UnifiedPreview>("/v1/radar/results/preview", { method: "POST", csrfToken: this.me.csrfToken, signal: this.selectionAbort.signal, body: JSON.stringify({ resultRef: row.radar.resultRef }) });
    if (!this.valid(epoch) || selection !== this.selectionEpoch) return;
    this.tick(); if (!this.view.snapshot) return;
    if (!r.ok) {
      if (r.status === 0 || r.status >= 500) {
        this.set({ preview: null, previewBusy: false, previewError: "Не удалось загрузить данные игрока. Попробуйте снова." });
      } else this.fail(r);
      return;
    }
    if (!liveUnifiedPreview(r.data, row.publicPlayerId, this.clock())) {
      this.close(); this.set({ notice: "Игрок сейчас недоступен. Обновите список." }); return;
    }
    this.set({ preview: r.data, previewBusy: false, previewError: "" });
  }
  dispose() { this.me = null; this.invalidate(); this.listeners.clear(); }
}
