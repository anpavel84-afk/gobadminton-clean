import type { UnifiedCapability, UnifiedFilters, UnifiedMapSnapshot, UnifiedOriginInput, UnifiedPreview, UnifiedRow, UnifiedSnapshot, UnifiedDistance } from "@gobadminton/contracts";
import { apiFetch, type ApiResult } from "./api-client";
import type { Me } from "./consumer-types";

export type ScopedCatalogCursor = { scope: string; value: string };
/** Pagination tokens belong to one exact filter + Radar-mode scope. */
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
const initial = (): DirectoryView => ({ mode: "ordinary", snapshot: null, rows: [], pins: [], mapPage: null, selected: null, preview: null, busy: false, previewBusy: false, notice: "", stale: false, capabilityUnavailable: false, authenticationRequired: false });
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
  matches(filters: UnifiedFilters, activationKey: string | null) { return Boolean(this.view.snapshot && Date.parse(this.view.snapshot.validUntil) > this.clock() && JSON.stringify(this.filters) === JSON.stringify(filters) && this.activationOriginKey === activationKey); }
  camera: { center: [number, number]; zoom: number } | null = null;
  scrollY = 0;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.view;
  constructor(private request = apiFetch, private clock = Date.now) {}
  private set(patch: Partial<DirectoryView>) { this.view = { ...this.view, ...patch }; this.listeners.forEach(fn => fn()); }
  private invalidate(notice = "", stale = false) {
    ++this.epoch; ++this.selectionEpoch; this.abort.abort(); this.abort = new AbortController(); this.pending = false;
    this.set({ snapshot: null, rows: [], pins: [], mapPage: null, selected: null, preview: null, busy: false, previewBusy: false, notice, stale });
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
    if (this.view.snapshot && this.clock() >= Date.parse(this.view.snapshot.validUntil)) {
      this.origin = { kind: "none" }; this.invalidate("Список устарел. Обновите участников Radar.", true);
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
    return data.contractVersion === UNIFIED_WIRE && data.cityId === this.filters?.cityId && Date.parse(data.validUntil) > this.clock();
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
    const epoch = this.epoch; this.pending = true; this.set({ busy: true });
    const r = await this.request<UnifiedMapSnapshot>("/v1/players/query/map", { method: "POST", csrfToken: me.csrfToken, signal: this.abort.signal, body: JSON.stringify({ contractVersion: UNIFIED_WIRE, queryRef: snapshot.query.queryRef, ...(next ? { mapCursor: this.view.mapPage!.nextMapCursor } : {}), limit: 100 }) });
    if (!this.valid(epoch)) return;
    this.pending = false; this.set({ busy: false });
    if (!r.ok) { this.fail(r); return; }
    if (!this.acceptable(r.data) || r.data.query.queryRef !== snapshot.query.queryRef) { this.invalidate("Список изменился. Обновите участников Radar.", true); return; }
    ++this.selectionEpoch;
    // Replace the map window; never silently accumulate/export the entire city.
    this.set({ pins: r.data.items.filter(row => row.radar !== null).slice(0, 200), mapPage: r.data.mapPage, selected: null, preview: null, previewBusy: false });
  }
  close() { ++this.selectionEpoch; this.set({ selected: null, preview: null, previewBusy: false }); }
  async select(row: UnifiedRow) {
    if (!row.radar || !this.me || this.pending || this.clock() < this.retryAt) return;
    this.tick(); if (!this.view.snapshot || ![...this.view.pins, ...this.view.rows].includes(row)) return;
    const epoch = this.epoch, selection = ++this.selectionEpoch;
    this.set({ selected: row.publicPlayerId, preview: null, previewBusy: true });
    const r = await this.request<UnifiedPreview>("/v1/radar/results/preview", { method: "POST", csrfToken: this.me.csrfToken, signal: this.abort.signal, body: JSON.stringify({ resultRef: row.radar.resultRef }) });
    if (!this.valid(epoch) || selection !== this.selectionEpoch) return;
    this.tick(); if (!this.view.snapshot) return;
    if (!r.ok) { this.fail(r); return; }
    if (r.data.player.publicPlayerId !== row.publicPlayerId || Date.parse(r.data.radar.validUntil) <= this.clock()) {
      this.close(); this.set({ notice: "Игрок сейчас недоступен. Обновите список." }); return;
    }
    this.set({ preview: r.data, previewBusy: false });
  }
  dispose() { this.me = null; this.invalidate(); this.listeners.clear(); }
}
