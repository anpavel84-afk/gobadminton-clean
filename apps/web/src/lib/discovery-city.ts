import { apiFetch, type ApiResult } from "./api-client";
import type { Me } from "./consumer-types";
import type { SelectedLocation } from "./location-context";

export const DISCOVERY_CITY_KEY = "gb.consumer.discoveryCity.v2";
export const MOSCOW = "a0000000-0000-4000-8000-000000000001";
export const PETERSBURG = "a0000000-0000-4000-8000-000000000002";
const YEAR = 365 * 86400000;
// The two frozen catalog groups; never trust caller/storage labels or municipalities.
export function supportedLocation(id: unknown): SelectedLocation | null {
  return id === MOSCOW || id === PETERSBURG ? { cityId: id, nameRu: id === MOSCOW ? "Москва" : "Санкт-Петербург", timezone: "Europe/Moscow" } : null;
}
export type ManualCity = { cityId: string; source: "manual"; savedAt: number; expiresAt: number; serverVersion?: number; sync: "pending" | "acknowledged" };
type DeviceCities = { guest?: ManualCity; accounts: Record<string, ManualCity> };
type Preference = { cityId: string | null; version: number };
export type CityView = { location: SelectedLocation | null; notice: string; unsynced: boolean; identityReady: boolean };
export const neutralCity: CityView = { location: null, notice: "", unsynced: false, identityReady: false };
export function validManual(value: unknown, now = Date.now()): value is ManualCity {
  if (!value || typeof value !== "object") return false;
  const v = value as ManualCity;
  return !!supportedLocation(v.cityId) && v.source === "manual" && Number.isFinite(v.savedAt) && Number.isFinite(v.expiresAt) && v.savedAt <= v.expiresAt && v.expiresAt > now && v.expiresAt - v.savedAt <= YEAR && ["pending", "acknowledged"].includes(v.sync) && (v.serverVersion === undefined || (Number.isSafeInteger(v.serverVersion) && v.serverVersion >= 0));
}
function validPreference(v: Preference): boolean {
  return !!v && (v.cityId === null || !!supportedLocation(v.cityId)) && Number.isSafeInteger(v.version) && v.version >= 0;
}
export function readDeviceCities(storage: Pick<Storage, "getItem"> | null, now = Date.now()): DeviceCities {
  try {
    const parsed = JSON.parse(storage?.getItem(DISCOVERY_CITY_KEY) || "{}");
    const accounts: Record<string, ManualCity> = Object.create(null);
    if (parsed.accounts && typeof parsed.accounts === "object") for (const [id, entry] of Object.entries(parsed.accounts)) if (validManual(entry, now)) accounts[id] = entry;
    return { ...(validManual(parsed.guest, now) ? { guest: parsed.guest } : {}), accounts };
  } catch { return { accounts: Object.create(null) }; }
}
function localStorageSafe(): Storage | null { try { return window.localStorage; } catch { return null; } }

/** One root-mounted resolver; identity and explicit-intent epochs fence all replies. */
export class DiscoveryCityController {
  private view = neutralCity;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private intent = 0;
  private me: Me | null = null;
  private devices: DeviceCities = { accounts: Object.create(null) };
  private pending: ManualCity | undefined;
  private version: number | null = null;
  private syncBusy = false;
  private readFailed = false;
  private abort = new AbortController();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(private request: typeof apiFetch = apiFetch, private storage: () => Storage | null = localStorageSafe, private clock = Date.now) {}
  private async bounded<T>(path: string, init: Parameters<typeof apiFetch>[1] = {}): Promise<ApiResult<T>> {
    const controller = new AbortController();
    const parent = init.signal; const abort = () => controller.abort();
    parent?.addEventListener("abort", abort, { once: true });
    if (parent?.aborted) abort();
    let aborted!: () => void;
    const deadline = new Promise<ApiResult<T>>(resolve => { aborted = () => resolve({ ok: false, status: 0, error: "City request interrupted" }); controller.signal.addEventListener("abort", aborted, { once: true }); });
    if (controller.signal.aborted) aborted();
    const timer = setTimeout(abort, 10000);
    try { return await Promise.race([this.request<T>(path, { ...init, signal: controller.signal }), deadline]); }
    finally { clearTimeout(timer); parent?.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", aborted); }
  }
  snapshot = () => this.view;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<CityView>) { this.view = { ...this.view, ...patch }; this.listeners.forEach(fn => fn()); }
  private commit(id: string) { this.set({ location: supportedLocation(id) }); }
  private entry(): ManualCity | undefined { return this.me ? this.devices.accounts[this.me.id] : this.devices.guest; }
  private persist(entry: ManualCity) {
    if (this.me) this.devices.accounts[this.me.id] = entry; else this.devices.guest = entry;
    try { const storage = this.storage(); if (!storage) throw new Error("storage unavailable"); storage.setItem(DISCOVERY_CITY_KEY, JSON.stringify(this.devices)); }
    catch { this.set({ notice: "Не удалось сохранить город на этом устройстве." }); }
  }
  private later(fn: () => void, ms: number) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); return t; }
  private cancel() { ++this.epoch; this.abort.abort(); this.abort = new AbortController(); this.timers.forEach(clearTimeout); this.timers.clear(); this.syncBusy = false; }
  dispose() { this.cancel(); this.listeners.clear(); }
  async start(sessionChanged = false) {
    this.cancel(); const epoch = this.epoch, signal = this.abort.signal;
    const previousActor = this.me?.id;
    this.me = null; this.version = null; this.pending = undefined; ++this.intent;
    const stored = readDeviceCities(this.storage(), this.clock());
    // Failed/quota writes still preserve deliberate in-memory choices this visit.
    const memory = this.devices;
    this.devices = { accounts: { ...Object.fromEntries(Object.entries(memory.accounts).filter(([,entry]) => validManual(entry, this.clock()))), ...stored.accounts }, ...(stored.guest ? { guest: stored.guest } : validManual(memory.guest, this.clock()) ? { guest: memory.guest } : {}) };
    this.readFailed = false;
    if (sessionChanged) {
      // Account caches are private to a login lifecycle; never carry them into guest/B.
      this.devices.accounts = Object.create(null);
      try { this.storage()?.setItem(DISCOVERY_CITY_KEY, JSON.stringify(this.devices)); } catch { /* memory remains safe */ }
    }
    this.set({ ...neutralCity });
    const valid = () => epoch === this.epoch && !signal.aborted;
    let hint = MOSCOW, hintSettled = !!this.devices.guest;
    const finishHint = (id: string) => { if (!valid() || hintSettled) return; hintSettled = true; hint = id; };
    if (!hintSettled) {
    const hintTimer = this.later(() => finishHint(MOSCOW), 500);
    void this.bounded<{ cityId: string; source: "ip" | "default" }>("/v1/discovery/city-hint", { signal }).then(r => {
      if (!valid() || hintSettled) return;
      clearTimeout(hintTimer); finishHint(r.ok && supportedLocation(r.data.cityId) && ["ip", "default"].includes(r.data.source) ? r.data.cityId : MOSCOW);
    });
    }
    const fallback = () => {
      if (!valid() || this.view.location) return;
      const manual = this.entry() || this.devices.guest;
      this.commit(manual?.cityId || hint);
    };
    // Total neutral-shell budget includes identity and account lookup, not 1500ms each.
    this.later(fallback, 1500);
    const account = await this.bounded<Me>("/v1/me", { signal });
    if (!valid()) return;
    if (!account.ok) {
      this.set({ identityReady: true });
      if (account.status !== 401) { this.readFailed = true; this.set({ notice: "Не удалось проверить сохранённый город. Можно продолжить поиск." }); }
      await new Promise<void>(resolve => this.later(resolve, hintSettled ? 0 : 500));
      fallback(); return;
    }
    this.me = account.data; this.set({ identityReady: true });
    if (previousActor && previousActor !== this.me.id) this.devices.accounts = Object.create(null);
    const cached = this.entry();
    if (cached?.sync === "pending") this.pending = cached;
    const intent = this.intent;
    const result = await this.bounded<Preference>("/v1/me/discovery-preference", { signal });
    if (!valid() || intent !== this.intent) return;
    if (!result.ok || !validPreference(result.data)) {
      this.readFailed = true;
      if (cached || this.pending) this.commit((this.pending || cached)!.cityId);
      fallback();
      this.set({ unsynced: !!this.pending, notice: this.pending ? "Город выбран. Сохранение в аккаунте не подтверждено." : this.view.notice });
      return;
    }
    this.version = result.data.version;
    if (this.pending) { this.commit(this.pending.cityId); await this.sync(); return; }
    if (intent !== this.intent) return;
    if (result.data.cityId) {
      this.commit(result.data.cityId);
      const now = this.clock(); this.persist({ cityId: result.data.cityId, source: "manual", savedAt: now, expiresAt: now + YEAR, serverVersion: result.data.version, sync: "acknowledged" });
    } else {
      const manual = cached || this.devices.guest;
      if (manual) { this.pending = { ...manual, sync: "pending" }; this.commit(manual.cityId); this.persist(this.pending); await this.sync(!cached); }
      else { await new Promise<void>(resolve => this.later(resolve, hintSettled ? 0 : 500)); fallback(); }
    }
  }
  choose(id: string) {
    if (!supportedLocation(id) || !this.view.identityReady) return false;
    ++this.intent; const now = this.clock();
    const entry: ManualCity = { cityId: id, source: "manual", savedAt: now, expiresAt: now + YEAR, sync: this.me ? "pending" : "acknowledged" };
    this.set({ notice: this.me ? "Город выбран. Сохраняем в аккаунте…" : "", unsynced: !!this.me });
    this.commit(id); this.persist(entry); this.pending = this.me ? entry : undefined;
    if (this.me) void this.sync();
    return true;
  }
  async retry() {
    if (this.syncBusy) return;
    if (!this.pending) { if (this.readFailed) await this.start(); return; }
    if (!this.me) return;
    this.version = null; await this.sync();
  }
  async sync(importGuest = false) {
    if (!this.me || !this.pending || this.syncBusy || this.abort.signal.aborted) return;
    this.syncBusy = true;
    const epoch = this.epoch, intent = this.intent, me = this.me, entry = this.pending, signal = this.abort.signal;
    const valid = () => epoch === this.epoch && intent === this.intent && !signal.aborted;
    try {
      let version = this.version;
      if (version === null) {
        const read = await this.bounded<Preference>("/v1/me/discovery-preference", { signal });
        if (!valid()) return;
        if (!read.ok || !validPreference(read.data)) { this.unsaved(); return; }
        version = read.data.version;
      }
      let result: ApiResult<Preference> = await this.bounded<Preference>("/v1/me/discovery-preference", { method: "PUT", body: JSON.stringify({ cityId: entry.cityId, expectedVersion: version }), csrfToken: me.csrfToken, idempotent: true, signal });
      if (!valid()) return;
      if (!result.ok && result.status === 409) {
        const read = await this.bounded<Preference>("/v1/me/discovery-preference", { signal });
        if (!valid()) return;
        if (read.ok && validPreference(read.data) && importGuest && read.data.cityId) {
          this.version = read.data.version; this.pending = undefined;
          this.commit(read.data.cityId); this.set({ unsynced: false, notice: "" });
          this.persist({ ...entry, cityId: read.data.cityId, serverVersion: read.data.version, sync: "acknowledged" });
          return;
        }
        if (read.ok && validPreference(read.data)) { version = read.data.version; result = await this.bounded<Preference>("/v1/me/discovery-preference", { method: "PUT", body: JSON.stringify({ cityId: entry.cityId, expectedVersion: read.data.version }), csrfToken: me.csrfToken, idempotent: true, signal }); }
      }
      if (!valid()) return;
      if (!result.ok || !validPreference(result.data) || result.data.cityId !== entry.cityId || result.data.version <= version) { this.unsaved(); return; }
      this.version = result.data.version; this.pending = undefined;
      this.set({ notice: "Город сохранён в аккаунте.", unsynced: false });
      this.persist({ ...entry, serverVersion: result.data.version, sync: "acknowledged" });
    } finally {
      if (epoch === this.epoch) { this.syncBusy = false; if (intent !== this.intent && this.pending) void this.sync(); }
    }
  }
  private unsaved() { this.set({ notice: "Город выбран. Сохранение в аккаунте не подтверждено.", unsynced: true }); }
  storageChanged() {
    const devices = readDeviceCities(this.storage(), this.clock());
    const entry = this.me ? devices.accounts[this.me.id] : devices.guest;
    if (!entry || JSON.stringify(entry) === JSON.stringify(this.entry())) return;
    ++this.intent; this.devices = devices; this.pending = this.me && entry.sync === "pending" ? entry : undefined;
    this.commit(entry.cityId); this.set({ notice: this.pending ? "Город выбран. Сохранение в аккаунте не подтверждено." : "", unsynced: !!this.pending });
    if (this.pending) void this.sync();
  }
}
