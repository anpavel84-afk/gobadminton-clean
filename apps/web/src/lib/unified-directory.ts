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
const initial = (): DirectoryView => ({ mode: "ordinary", snapshot: null, rows: [], pins: [], mapPage: null, selected: null, preview: null, busy: false, previewBusy: false, notice: "", stale: false, capabilityUnavailable: false, authenticationRequired: false });
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const keys = (v: Record<string, unknown>, allowed: string[], required = allowed) =>
  Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k));
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const instant = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const cover = (v: unknown) => object(v) && keys(v, ["uploadedUrl"]) && (v.uploadedUrl === null || text(v.uploadedUrl));
/** Admit the entire strict wire shape, never a partial player/TTL or a legacy
 * preview. Used again at render time so retained schedules cannot outlive TTL.
 */
export function liveUnifiedPreview(value: unknown, publicId: string, now: number): value is UnifiedPreview {
  if (!object(value) || !keys(value, ["player", "proximityBand", "radar", "upcomingGames"]) || value.proximityBand !== null) return false;
  const p = value.player, r = value.radar;
  if (!object(p) || !keys(p, ["publicPlayerId", "displayName", "level", "trainer", "avatar", "canRequestContact"], ["publicPlayerId", "displayName", "level", "trainer"]) ||
      p.publicPlayerId !== publicId || !text(p.displayName) || typeof p.trainer !== "boolean" ||
      (p.canRequestContact !== undefined && typeof p.canRequestContact !== "boolean")) return false;
  if (p.avatar !== undefined && (!object(p.avatar) || !keys(p.avatar, ["uploadedUrl", "providerUrl"]) ||
      ![p.avatar.uploadedUrl, p.avatar.providerUrl].every(v => v === null || text(v)))) return false;
  if (p.level !== null && (!object(p.level) || !keys(p.level, ["scaleId", "scaleVersion", "levelId", "provenance"]) ||
      !text(p.level.scaleId) || !Number.isInteger(p.level.scaleVersion) || Number(p.level.scaleVersion) < 1 || !text(p.level.levelId) || p.level.provenance !== "self_declared")) return false;
  if (!object(r) || !keys(r, ["consentPolicyVersion", "geo", "validUntil", "distance"]) || r.consentPolicyVersion !== "radar-geographic-sharing-v2" || !instant(r.validUntil) || Date.parse(r.validUntil) <= now) return false;
  const g = r.geo;
  if (!object(g) || !keys(g, ["latitude", "longitude", "crs", "model", "gridSizeMeters", "uncertaintyMeters", "quality", "sourceTimestampBucket", "sourceAgeSeconds"]) ||
      !finite(g.latitude) || Math.abs(g.latitude) > 90 || !finite(g.longitude) || Math.abs(g.longitude) > 180 || g.crs !== "EPSG:4326" ||
      !((g.model === "regional_grid_100m_v1" && g.gridSizeMeters === 100) || (g.model === "regional_grid_1000m_v1" && g.gridSizeMeters === 1000)) ||
      !finite(g.uncertaintyMeters) || g.uncertaintyMeters < 0 || !["approximate", "degraded"].includes(String(g.quality)) || !instant(g.sourceTimestampBucket) || !finite(g.sourceAgeSeconds) || g.sourceAgeSeconds < 0) return false;
  const d = r.distance;
  if (d !== null && (!object(d) || !keys(d, ["kind", "roundedMeters", "roundingStepMeters", "uncertaintyMeters", "lowerMeters", "upperMeters", "basis", "approximate"]) ||
      d.basis !== "published_centers_geodesic" || d.approximate !== true || !finite(d.roundingStepMeters) || ![100, 500, 1000].includes(d.roundingStepMeters) || !finite(d.uncertaintyMeters) || d.uncertaintyMeters < 0 ||
      !(d.kind === "estimate" ? finite(d.roundedMeters) && d.roundedMeters >= 0 && d.lowerMeters === null && d.upperMeters === null :
        d.kind === "range" && d.roundedMeters === null && d.lowerMeters === 0 && finite(d.upperMeters) && d.upperMeters >= 0))) return false;
  if (!Array.isArray(value.upcomingGames) || value.upcomingGames.length > 3) return false;
  const seen = new Set<string>(); let previous: { start: number; id: string } | null = null;
  for (const game of value.upcomingGames) {
    if (!object(game) || !keys(game, ["id", "title", "activityKind", "startsAt", "endsAt", "timezone", "cover", "venue"]) ||
        !text(game.id) || seen.has(game.id) || !text(game.title) || !["regular", "trainer_led"].includes(String(game.activityKind)) ||
        !instant(game.startsAt) || !instant(game.endsAt) || Date.parse(game.startsAt) <= now || Date.parse(game.endsAt) <= Date.parse(game.startsAt) ||
        !text(game.timezone) || !cover(game.cover) || !object(game.venue) || !keys(game.venue, ["name", "cover"]) || !text(game.venue.name) || !cover(game.venue.cover)) return false;
    try { new Intl.DateTimeFormat("ru-RU", { timeZone: game.timezone }); } catch { return false; }
    const start = Date.parse(game.startsAt);
    if (previous && (start < previous.start || start === previous.start && game.id <= previous.id)) return false;
    seen.add(game.id); previous = { start, id: game.id };
  }
  return true;
}
/** Private contexts/proofs/origins live only in this root-client session, never URLs/storage. */
export class UnifiedDirectoryController {
  view = initial();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private selectionEpoch = 0;
  private abort = new AbortController();
  private me: Me | null = null;
  private visible = true;
  private filters: UnifiedFilters | null = null;
  private origin: UnifiedOriginInput = { kind: "none" };
  private nextInitial = 0;
  private retryAt = 0;
  private pending = false;
  private activationOriginKey: string | null = null;
  /**
   * True only while the authorized snapshot still matches filters/activation AND
   * has not yet reached the server refresh recommendation. Recovery must refresh
   * before validUntil; matching TTL alone left a blank gap after tick expiry.
   */
  matches(filters: UnifiedFilters, activationKey: string | null) {
    if (!this.renderable(filters, activationKey)) return false;
    const snapshot = this.view.snapshot!;
    const generated = Date.parse(snapshot.generatedAt);
    if (!Number.isFinite(generated)) return false;
    const refreshAfterSeconds = typeof snapshot.refreshAfterSeconds === "number" ? snapshot.refreshAfterSeconds : 30;
    return this.clock() < generated + refreshAfterSeconds * 1000;
  }
  /**
   * Authorized window still showable in the list/map: same filters/activation,
   * non-stale, current auth, and within validUntil — independent of refresh-due.
   * Soft refresh may leave matches() false while rows remain renderable.
   */
  renderable(filters: UnifiedFilters, activationKey: string | null) {
    const snapshot = this.view.snapshot;
    if (!snapshot || this.view.mode !== "unified" || this.view.stale || this.view.authenticationRequired || this.view.capabilityUnavailable) return false;
    if (JSON.stringify(this.filters) !== JSON.stringify(filters) || this.activationOriginKey !== activationKey) return false;
    const until = Date.parse(snapshot.validUntil);
    return Number.isFinite(until) && until > this.clock();
  }
  /**
   * Absolute clock when RadarPage may next soft-refresh / retry.
   * Honours 30s initial cooldown and 429 retryAt; while a request is pending,
   * callers should await settlement (subscribe) instead of busy-looping.
   * After invalidate (409/410/429), gate alone decides — no extra fixed 30s wait.
   */
  nextRefreshAt() {
    const now = this.clock();
    const gate = Math.max(this.nextInitial, this.retryAt);
    if (this.pending) return Math.max(gate, now + 1000);
    const snapshot = this.view.snapshot;
    if (!snapshot) return Math.max(gate, now);
    const generated = Date.parse(snapshot.generatedAt);
    const until = Date.parse(snapshot.validUntil);
    if (!Number.isFinite(generated) || !Number.isFinite(until)) return Math.max(gate, now + 30000);
    const refreshAfter = typeof snapshot.refreshAfterSeconds === "number" ? snapshot.refreshAfterSeconds : 30;
    const due = Math.min(generated + refreshAfter * 1000, until);
    return Math.max(gate, due);
  }
  camera: { center: [number, number]; zoom: number } | null = null;
  scrollY = 0;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.view;
  constructor(private request = apiFetch, private clock = Date.now) {}
  private set(patch: Partial<DirectoryView>) { this.view = { ...this.view, ...patch }; this.listeners.forEach(fn => fn()); }
  private fence() {
    ++this.epoch; ++this.selectionEpoch; this.abort.abort(); this.abort = new AbortController(); this.pending = false;
  }
  /** Cleared private projection fields — applied with mode/capability in one set(). */
  private clearedPrivate(notice = "", stale = false): Partial<DirectoryView> {
    return { snapshot: null, rows: [], pins: [], mapPage: null, selected: null, preview: null, busy: false, previewBusy: false, notice, stale };
  }
  private invalidate(notice = "", stale = false) {
    this.fence();
    this.set(this.clearedPrivate(notice, stale));
  }
  /** Still-authorized same-key window that soft refresh may keep across transient read failures. */
  private retainableWindow() {
    const snapshot = this.view.snapshot;
    if (this.view.mode !== "unified" || this.view.stale || this.view.authenticationRequired || this.view.capabilityUnavailable || !snapshot) return false;
    const until = Date.parse(snapshot.validUntil);
    if (!Number.isFinite(until) || until <= this.clock()) return false;
    const live = (row: UnifiedRow) => !row.radar || (Number.isFinite(Date.parse(row.radar.validUntil)) && Date.parse(row.radar.validUntil) > this.clock());
    return this.view.rows.every(live) && this.view.pins.every(live);
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
  /**
   * Terminal read failure: install pending/retryAt/nextInitial/origin/capability/mode+fence
   * BEFORE any subscriber notification. Never publish a transient busy:false ahead of Retry-After.
   */
  private fail(result: Exclude<ApiResult<unknown>, { ok: true }>, softRetain = false) {
    if (result.status === 404) {
      this.origin = { kind: "none" }; this.activationOriginKey = null; this.camera = null; this.scrollY = 0; this.nextInitial = 0;
      this.fence();
      // RESOURCE_UNAVAILABLE is an expired/changed origin or proof — not missing capability.
      if (result.problem?.code === "RESOURCE_UNAVAILABLE") {
        this.set({
          ...this.clearedPrivate("Список участников Radar устарел. Обновляем данные.", true),
          mode: "ordinary",
          capabilityUnavailable: false,
        });
        return;
      }
      this.set({
        ...this.clearedPrivate("Участники Radar сейчас недоступны. Можно пользоваться обычным каталогом."),
        mode: "ordinary",
        capabilityUnavailable: true,
      });
      return;
    }
    // Install recovery gates before any publication (including soft-retain busy:false).
    if (result.status === 429) {
      this.retryAt = this.clock() + (result.retryAfterSeconds ?? 60) * 1000;
      // Honour server Retry-After only; do not stack another fixed 30s initial wait.
      this.nextInitial = 0;
    }
    // 409/410 are recoverable with a fresh current_activation initial; do not keep the
    // prior 30s initial gate that would leave list/map blank until cooldown ends.
    if (result.status === 409 || result.status === 410) this.nextInitial = 0;
    const notice = result.status === 401 ? "Войдите снова, чтобы смотреть участников Radar." : result.status === 403 ? "Нет доступа к участникам Radar. Можно смотреть обычный каталог." : result.status === 429 ? "Попробуйте обновить список немного позже." : result.status === 409 || result.status === 410 ? "Список изменился. Обновляем участников Radar." : result.status === 422 ? "Radar недоступен для выбранного города или геопозиции. Можно смотреть обычный каталог." : "Не удалось загрузить участников Radar. Попробуйте снова.";
    const transient = result.status === 429 || result.status === 0 || result.status >= 500;
    // Soft same-key refresh: keep only currently authorized non-expired rows/pins across 429/network/5xx.
    if (softRetain && transient && this.retainableWindow()) {
      const until = Date.parse(this.view.snapshot!.validUntil);
      if (result.status === 429 && this.retryAt > until) {
        this.origin = { kind: "none" };
        this.fence();
        this.set({ ...this.clearedPrivate(notice, true), mode: "ordinary" });
        return;
      }
      // Drop the pre-request 30s nextInitial gate; retry soon within the still-valid TTL.
      // 429 already schedules via retryAt; other transients use a bounded ~2s retry.
      if (result.status !== 429) {
        this.nextInitial = Math.min(this.clock() + 2000, until);
      }
      this.pending = false;
      this.set({ busy: false, notice, stale: false });
      return;
    }
    this.origin = { kind: "none" };
    this.fence();
    // Cleared private projection always leaves ordinary until a fresh unified initial commits.
    this.set({
      ...this.clearedPrivate(notice, true),
      mode: "ordinary",
      ...(result.status === 401 ? { authenticationRequired: true } : {}),
    });
  }
  tick() {
    const now = this.clock();
    const snapshotExpired = this.view.snapshot && (!Number.isFinite(Date.parse(this.view.snapshot.validUntil)) || now >= Date.parse(this.view.snapshot.validUntil));
    // Target proof/lease may expire sooner than the enclosing 45-second
    // private query. Never retain its selection, preview or map pins after TTL.
    const rowExpired = [...this.view.rows, ...this.view.pins].some(row =>
      row.radar && (!Number.isFinite(Date.parse(row.radar.validUntil)) || Date.parse(row.radar.validUntil) <= now));
    const previewExpired = this.view.preview && !liveUnifiedPreview(this.view.preview, this.view.selected ?? "", now);
    if (snapshotExpired || rowExpired || previewExpired) {
      this.origin = { kind: "none" };
      // Allow immediate current_activation recovery; expired markers must not linger.
      this.nextInitial = 0;
      // Clear displayed private data promptly. An in-flight same-epoch refresh that is still
      // authorized must not be aborted solely because the old displayed window expired —
      // its successful commit may restore a fresh window; fence only when nothing is pending.
      if (this.pending) {
        ++this.selectionEpoch;
        this.set({
          mode: "ordinary", snapshot: null, rows: [], pins: [], mapPage: null, selected: null, preview: null,
          busy: false, previewBusy: false, notice: "Список участников Radar устарел. Обновляем данные.", stale: true,
        });
        return;
      }
      // Fence + mode + clear publish atomically so subscribers cannot re-arm unified mid-transition.
      this.fence();
      this.set({
        mode: "ordinary", snapshot: null, rows: [], pins: [], mapPage: null, selected: null, preview: null,
        busy: false, previewBusy: false, notice: "Список участников Radar устарел. Обновляем данные.", stale: true,
      });
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
      if (changed) {
        // Any filter/full activation key change (including version) keeps strict invalidation.
        // Same-key soft refresh retaining a valid window while matches() is due is handled below.
        this.invalidate();
        this.set({ mode: "ordinary" });
        // Never retain a raw foreground fix while waiting for the cooldown.
        this.origin = { kind: "none" };
        this.set({ stale: true, notice: "Обновить участников Radar можно через несколько секунд. Пока доступен обычный каталог." });
      }
      // Unchanged early request during cooldown must not falsely stale/blank a still-valid window.
      return;
    }
    const keepWindow = !changed
      && this.view.mode === "unified"
      && !this.view.stale
      && this.view.snapshot !== null
      && Number.isFinite(Date.parse(this.view.snapshot.validUntil))
      && Date.parse(this.view.snapshot.validUntil) > this.clock();
    this.filters = filters; this.origin = origin; this.activationOriginKey = activationKey;
    const previousQueryRef = this.view.snapshot?.query.queryRef ?? null;
    const previousSelected = keepWindow ? this.view.selected : null;
    const previousPreview = keepWindow ? this.view.preview : null;
    const previousPins = keepWindow ? this.view.pins : [];
    const previousMapPage = keepWindow ? this.view.mapPage : null;
    const previouslyMapped = previousMapPage !== null || previousPins.length > 0;
    // Soft refresh may await query/map; close()/select()/map() bump selectionEpoch meanwhile.
    const selectionGeneration = this.selectionEpoch;
    if (!keepWindow) {
      this.invalidate();
      this.set({ mode: "unified" });
    } else {
      // Soft proactive refresh: fence in-flight without blanking still-valid authorized geometry.
      ++this.epoch;
      this.abort.abort();
      this.abort = new AbortController();
      this.pending = false;
    }
    this.nextInitial = this.clock() + 30000;
    const epoch = this.epoch; this.pending = true;
    if (!keepWindow) this.set({ busy: true });
    const result = await this.request<UnifiedSnapshot>("/v1/players/query", { method: "POST", csrfToken: this.me.csrfToken, signal: this.abort.signal, body: JSON.stringify({ contractVersion: UNIFIED_WIRE, filters, origin, limit: 50 }) });
    if (!this.valid(epoch)) return;
    // Settle failure gates before any busy:false publication (Retry-After / resource-404 races).
    if (!result.ok) { this.pending = false; this.fail(result, keepWindow); return; }
    if (!this.acceptable(result.data)) { this.pending = false; this.invalidate("Список устарел. Обновите участников Radar.", true); return; }
    // Never retain the transient raw foreground input once the server issued a private reference.
    this.origin = result.data.query.originRef ? { kind: "reference", originRef: result.data.query.originRef } : { kind: "none" };
    const notice = result.data.query.originState === "none" ? "Участники Radar по городу. Расстояние неизвестно." : "Расстояние приблизительное, по опубликованным геопозициям.";
    if (!keepWindow) {
      // Fresh initial must publish consistent unified mode with the snapshot (not leave ordinary after recovery).
      this.pending = false;
      this.set({
        busy: false, mode: "unified", stale: false, capabilityUnavailable: false,
        snapshot: result.data, rows: result.data.items, notice,
      });
      return;
    }
    const queryRefChanged = result.data.query.queryRef !== previousQueryRef;
    let mapPins = previousPins;
    let mapPage = previousMapPage;
    let mapItems: UnifiedRow[] = [];
    // Previously mapped soft refresh: stage fresh queryRef + validated map, then commit atomically.
    // Retain still-valid old pins until both settle; never blank or pair old map cursor with a new queryRef.
    if (queryRefChanged && previouslyMapped) {
      const mapResult = await this.request<UnifiedMapSnapshot>("/v1/players/query/map", {
        method: "POST",
        csrfToken: this.me.csrfToken,
        signal: this.abort.signal,
        body: JSON.stringify({ contractVersion: UNIFIED_WIRE, queryRef: result.data.query.queryRef, limit: 100 }),
      });
      if (!this.valid(epoch)) return;
      this.pending = false;
      if (!mapResult.ok) { this.fail(mapResult, true); return; }
      if (!this.acceptable(mapResult.data) || mapResult.data.query.queryRef !== result.data.query.queryRef) {
        this.invalidate("Список изменился. Обновите участников Radar.", true);
        return;
      }
      mapItems = mapResult.data.items;
      mapPins = mapResult.data.items.filter(row => row.radar !== null).slice(0, 200);
      mapPage = mapResult.data.mapPage;
    } else {
      this.pending = false;
      if (queryRefChanged) { mapPins = []; mapPage = null; }
    }
    const now = this.clock();
    // Always commit refreshed rows/pins; only restore/redeem selection if still current.
    const selectionCurrent = selectionGeneration === this.selectionEpoch;
    const livePeer = (row: UnifiedRow) => row.publicPlayerId === previousSelected && row.radar !== null && Date.parse(row.radar.validUntil) > now;
    const keepRow = previousSelected && selectionCurrent
      ? (result.data.items.find(livePeer) ?? mapItems.find(livePeer) ?? mapPins.find(livePeer))
      : undefined;
    const keepPreview = Boolean(keepRow && !queryRefChanged && previousPreview && liveUnifiedPreview(previousPreview, keepRow.publicPlayerId, now));
    this.set({
      snapshot: result.data,
      rows: result.data.items,
      notice,
      stale: false,
      busy: false,
      mode: "unified",
      pins: mapPins,
      mapPage,
      ...(selectionCurrent ? {
        selected: keepRow ? keepRow.publicPlayerId : null,
        preview: keepPreview ? previousPreview : null,
        previewBusy: false,
      } : {}),
    });
    // New queryRef needs a fresh proof redemption; same-ref preview may stay until its own TTL.
    if (keepRow && !keepPreview) void this.select(keepRow);
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
    this.pending = false;
    if (!r.ok) { this.fail(r); return; }
    if (!this.acceptable(r.data) || r.data.query.queryRef !== snapshot.query.queryRef) { this.invalidate("Список изменился. Обновите участников Radar.", true); return; }
    this.set({ busy: false, snapshot: r.data, rows: [...this.view.rows, ...r.data.items.filter(row => !this.view.rows.some(old => old.publicPlayerId === row.publicPlayerId))] });
  }
  async map(next = false) {
    const snapshot = this.view.snapshot, me = this.me;
    if (!snapshot || !me || this.pending || (next && !this.view.mapPage?.nextMapCursor)) return;
    this.tick(); if (!this.view.snapshot) return;
    const epoch = this.epoch; this.pending = true; this.set({ busy: true });
    const r = await this.request<UnifiedMapSnapshot>("/v1/players/query/map", { method: "POST", csrfToken: me.csrfToken, signal: this.abort.signal, body: JSON.stringify({ contractVersion: UNIFIED_WIRE, queryRef: snapshot.query.queryRef, ...(next ? { mapCursor: this.view.mapPage!.nextMapCursor } : {}), limit: 100 }) });
    if (!this.valid(epoch)) return;
    this.pending = false;
    if (!r.ok) { this.fail(r); return; }
    if (!this.acceptable(r.data) || r.data.query.queryRef !== snapshot.query.queryRef) { this.invalidate("Список изменился. Обновите участников Radar.", true); return; }
    ++this.selectionEpoch;
    // Replace the map window; never silently accumulate/export the entire city.
    this.set({ busy: false, pins: r.data.items.filter(row => row.radar !== null).slice(0, 200), mapPage: r.data.mapPage, selected: null, preview: null, previewBusy: false });
  }
  close() { ++this.selectionEpoch; this.set({ selected: null, preview: null, previewBusy: false }); }
  async select(row: UnifiedRow) {
    if (!row.radar || !this.me || this.pending || this.clock() < this.retryAt) return;
    this.tick(); if (!this.view.snapshot || ![...this.view.pins, ...this.view.rows].includes(row)) return;
    const epoch = this.epoch, selection = ++this.selectionEpoch;
    this.set({ selected: row.publicPlayerId, preview: null, previewBusy: true, notice: "" });
    let r: ApiResult<UnifiedPreview>;
    try {
      r = await this.request<UnifiedPreview>("/v1/radar/results/preview", { method: "POST", csrfToken: this.me.csrfToken, signal: this.abort.signal, body: JSON.stringify({ resultRef: row.radar.resultRef }) });
    } catch {
      r = { ok: false, status: 0, error: "Не удалось загрузить карточку игрока." };
    }
    if (!this.valid(epoch) || selection !== this.selectionEpoch) return;
    this.tick(); if (!this.view.snapshot) return;
    if (!r.ok) {
      if (r.status === 0 || r.status >= 500) { this.set({ preview: null, previewBusy: false, notice: "Не удалось загрузить карточку игрока. Попробуйте снова." }); return; }
      this.fail(r); return;
    }
    if (!liveUnifiedPreview(r.data, row.publicPlayerId, this.clock())) {
      this.close(); this.set({ notice: "Игрок сейчас недоступен. Обновите список." }); return;
    }
    this.set({ preview: r.data, previewBusy: false });
  }
  dispose() { this.me = null; this.invalidate(); this.listeners.clear(); }
}
