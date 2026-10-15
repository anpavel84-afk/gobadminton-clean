import type { RadarConfig } from "./unified-directory";
import { UNIFIED_WIRE } from "./unified-directory";
import { apiFetch, type ApiResult } from "./api-client";
import type { Me, OwnSocialProfile } from "./consumer-types";
import { isAdmittedDemoCity } from "./radar-demo-fix";
import { effectiveDeadline, radarHonestyNotice } from "./radar-presentation";
import type { RadarActivation, RadarExposureMode, RadarFix, RadarItem, RadarNearby, RadarPreview, RadarStatus } from "./radar-types";

type Phase = "checking" | "guest" | "off" | "permission" | "locating" | "denied" | "location_error" | "activating" | "active" | "owned_elsewhere" | "expired" | "stopping" | "stopped" | "background" | "error" | "disabled";
export type RadarView = {
  phase: Phase; me: Me | null; status: RadarStatus | null; items: RadarItem[]; loading: boolean; selected: string | null; preview: RadarPreview | null; previewLoading: boolean; notice: string; now: number;
  exposureMode: RadarExposureMode | null; demoCityId: string | null; confirmedOn: boolean; pendingStop: boolean;
};
export type RadarDuration = "15m" | "1h" | "until_off";
type Fetcher = typeof apiFetch;
const CURRENT = "/v1/me/radar/activations/current";
/** Only memory owns fixes/proofs. Every async read is fenced by epoch and selection. */
export class RadarController {
  view: RadarView = { phase: "checking", me: null, status: null, items: [], loading: false, selected: null, preview: null, previewLoading: false, notice: "", now: Date.now(), exposureMode: null, demoCityId: null, confirmedOn: false, pendingStop: false };
  duration: RadarDuration = "15m";
  private intentUntil = Infinity;
  private continuationConsented = false;
  chooseDuration(duration: RadarDuration) { if (this.view.phase === "permission") { this.duration = duration; this.set({}); } }
  private listeners = new Set<() => void>();
  private epoch = 0;
  private visible = true;
  private disposed = false;
  private busy = false;
  private freshUntil = 0;
  private nextRead = 0;
  private nextHeartbeat = Infinity;
  private retryAt = 0;
  private resultView: "list" | "map" | "none" = "map";
  private mutationDispatched = false;
  private stopIntent: { activationId: string; userId: string; csrfToken: string } | null = null;
  private reconcileEpoch: number | null = null;
  private selectionEpoch = 0;
  listScrollY = 0;
  config: RadarConfig | null = null;
  configure(config: RadarConfig | null, demoCityId: string | null = this.view.demoCityId) { this.config = config; if (config) this.set({ exposureMode: config.exposureMode, demoCityId }); }
  constructor(private request: Fetcher = apiFetch, private clock = Date.now) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.view;
  private set(patch: Partial<RadarView>) { this.view = { ...this.view, ...patch, now: this.clock() }; this.listeners.forEach(f => f()); }
  private clear() { ++this.selectionEpoch; this.freshUntil = 0; this.set({ items: [], selected: null, preview: null, previewLoading: false, loading: false }); }
  private valid(epoch: number) { return !this.disposed && this.visible && epoch === this.epoch; }
  private fail(result: Exclude<ApiResult<unknown>, { ok: true }>) {
    this.clear();
    this.intentUntil = Infinity; this.continuationConsented = false;
    if (result.status === 401) { this.stopIntent = null; this.set({ phase: "guest", me: null, status: null, confirmedOn: false, pendingStop: false }); return; }
    if (result.status === 429) this.retryAt = this.clock() + (result.retryAfterSeconds ?? 60) * 1000;
    this.set({ phase: result.problem?.code === "SOCIAL_RADAR_DISABLED" && !this.view.confirmedOn ? "disabled" : "error", notice: result.problem?.code === "RADAR_REGION_UNSUPPORTED" ? "Radar пока недоступен в этом регионе. Откройте обычный список игроков." : result.status === 429 ? "Radar обновляется слишком часто. Попробуйте позже." : "Не удалось проверить Radar. Проверьте статус перед следующим действием." });
  }
  async reconcile() {
    if (!this.visible || this.disposed || this.reconcileEpoch === this.epoch || this.clock() < this.retryAt) return;
    const epoch = ++this.epoch; this.reconcileEpoch = epoch;
    try {
    this.busy = true; this.clear(); this.set({ phase: "checking", notice: "", exposureMode: null, demoCityId: null });
    const me = await this.request<Me>("/v1/me");
    if (!this.valid(epoch)) return;
    if (!me.ok) { this.busy = false; this.fail(me); return; }
    if (this.view.me && (this.view.me.id !== me.data.id || this.view.me.csrfToken !== me.data.csrfToken)) {
      this.stopIntent = null; this.set({ status: null, confirmedOn: false, pendingStop: false });
    }
    this.set({ me: me.data });
    const status = await this.request<RadarStatus>(CURRENT);
    if (!this.valid(epoch)) return;
    if (!status.ok) { this.busy = false; this.fail(status); return; }
    let demoCityId: string | null = null;
    if ((status.data.exposureMode ?? this.config?.exposureMode) === "synthetic_demo") {
      const profile = await this.request<OwnSocialProfile>("/v1/me/social-profile");
      if (!this.valid(epoch)) return;
      if (profile.ok && isAdmittedDemoCity(profile.data.cityId)) {
        demoCityId = profile.data.cityId;
      } else {
        // QRDA-F02: missing/unsupported/failed profile city must fail closed —
        // never enter permission/activate paths that could collect browser GPS.
        this.busy = false;
        this.set({
          me: me.data,
          status: status.data,
          exposureMode: "synthetic_demo",
          demoCityId: null,
          phase: "location_error",
          notice:
            "Для демо Radar нужна допущенная городская привязка профиля. Браузерная геолокация не используется.",
        });
        return;
      }
    }
    this.busy = false;
    if (this.stopIntent) {
      const sameIdentity = this.stopIntent.userId === me.data.id && this.stopIntent.csrfToken === me.data.csrfToken;
      if (sameIdentity && "activationId" in status.data && status.data.activationId === this.stopIntent.activationId) {
        this.set({ status: status.data, exposureMode: status.data.exposureMode, demoCityId });
        await this.stop(); return;
      }
      // An old stop intent must never delete a takeover/new account generation.
      this.stopIntent = null; this.set({ pendingStop: false });
    }
    this.accept({ ...status.data, exposureMode: status.data.exposureMode ?? this.config?.exposureMode }, demoCityId);
    if (status.data.state === "active" && this.view.phase === "active" && this.resultView !== "none") {
      if (this.clock() >= this.nextRead) await this.nearby(epoch);
      else this.set({ loading: true });
    }
    } finally { if (this.reconcileEpoch === epoch) this.reconcileEpoch = null; }
  }
  private accept(status: RadarStatus, demoCityId: string | null = this.view.demoCityId) {
    status = { ...status, exposureMode: status.exposureMode ?? this.config?.exposureMode };
    const honesty = radarHonestyNotice(status.exposureMode);
    this.set({ status, phase: status.state, confirmedOn: status.state === "active" || status.state === "owned_elsewhere", notice: honesty, exposureMode: status.exposureMode, demoCityId });
    if (status.state !== "active") { this.continuationConsented = false; this.clear(); return; }
    if (!(effectiveDeadline(status) > this.clock())) { this.continuationConsented = false; this.clear(); this.set({ phase: "expired", confirmedOn: false }); return; }
    this.nextHeartbeat = this.clock() + Math.max(1000, (Date.parse(status.foregroundUntil) - this.clock()) / 2);
  }
  /** Demo mode skips browser geolocation; live mode still requires an explicit permission step. */
  permission() {
    if (this.view.phase === "guest") { this.set({ notice: "Войдите, чтобы включить Radar" }); return; }
    if (!["off", "stopped", "expired", "denied", "location_error", "owned_elsewhere"].includes(this.view.phase)) return;
    if (this.view.exposureMode === "synthetic_demo") {
      if (!this.usesSyntheticLocation()) {
        // Re-check profile city; never open the GPS permission/activate path.
        void this.reconcile();
        return;
      }
      this.set({ phase: "permission", notice: radarHonestyNotice("synthetic_demo") });
      return;
    }
    if (this.view.exposureMode === "live") this.set({ phase: "permission", notice: "" });
  }
  usesSyntheticLocation(): boolean {
    return this.view.exposureMode === "synthetic_demo" && isAdmittedDemoCity(this.view.demoCityId);
  }
  cancel() {
    // A sent mutation has an unresolved outcome; it completes at provider level.
    if (this.mutationDispatched) return;
    ++this.epoch; this.busy = false; this.clear(); void this.reconcile();
  }
  closePreview() { ++this.selectionEpoch; this.set({ selected: null, preview: null, previewLoading: false }); }
  refresh() { if (this.view.phase === "active" && !this.busy && this.clock() >= this.nextRead && this.clock() >= this.retryAt) void this.nearby(this.epoch); }
  setResultView(view: "list" | "map" | "none") {
    this.resultView = view;
    if (view !== "list" && ["permission", "locating"].includes(this.view.phase) && !this.mutationDispatched && (view === "none" || this.view.status?.state !== "active")) this.cancel();
    if (view === "map" && this.view.phase === "active" && !this.view.selected && this.view.items[0]) void this.select(this.view.items[0]);
    if (view !== "none") this.refresh();
  }
  async checkIdentity() {
    if (!this.visible || this.disposed || this.reconcileEpoch === this.epoch) return;
    const epoch = this.epoch, previous = this.view.me;
    const me = await this.request<Me>("/v1/me");
    if (!this.valid(epoch)) return;
    if (!me.ok || !previous || me.data.id !== previous.id || me.data.csrfToken !== previous.csrfToken) {
      ++this.epoch; this.busy = false; this.clear(); this.stopIntent = null; this.continuationConsented = false;
      this.set({ me: null, status: null, confirmedOn: false, pendingStop: false });
      await this.reconcile();
    }
  }
  private async identityCurrent(epoch: number, me: Me) {
    const current = await this.request<Me>("/v1/me");
    if (!this.valid(epoch)) return false;
    if (!current.ok || current.data.id !== me.id || current.data.csrfToken !== me.csrfToken) {
      this.busy = false; ++this.epoch; this.clear(); this.stopIntent = null; this.continuationConsented = false;
      this.set({ me: null, status: null, confirmedOn: false, pendingStop: false });
      await this.reconcile(); return false;
    }
    return true;
  }
  async activate(acquire: () => Promise<RadarFix>, mode: "start" | "renew" | "location" = "start") {
    if (!this.view.me || this.busy || this.mutationDispatched || !this.visible || this.disposed || this.clock() < this.retryAt) return;
    if (this.config && !this.config.publishingV2.enabled) { this.set({ phase: "disabled" }); return; }
    if (this.view.exposureMode !== "live" && this.view.exposureMode !== "synthetic_demo") return;
    if (mode === "start" ? this.view.phase !== "permission" : this.view.phase !== "active") return;
    // QRDA-F02: synthetic demo without admitted city never invokes the acquisition callback
    // (The shared provider separately fences acquisition by exposure mode).
    if (this.view.exposureMode === "synthetic_demo" && !this.usesSyntheticLocation()) {
      this.set({
        phase: "location_error",
        notice:
          "Для демо Radar нужна допущенная городская привязка профиля. Браузерная геолокация не используется.",
      });
      return;
    }
    const me = this.view.me, previous = this.view.status;
    const needsFix = mode !== "renew" || previous?.state !== "active" || this.clock() >= Date.parse(previous.nextLocationUpdateAt);
    const epoch = ++this.epoch; this.busy = true; this.clear(); this.set({ phase: needsFix ? "locating" : "activating", notice: "" });
    let fix: RadarFix | undefined;
    try { if (needsFix) fix = await acquire(); }
    catch (e) {
      if (this.valid(epoch)) {
        this.busy = false;
        // A failed fresh fix must not leave an old activation discoverable.
        if (previous?.state === "active") {
          await this.stop();
          if (this.view.phase !== "stopped") return;
        }
        this.set({ phase: (e as { code?: number }).code === 1 ? "denied" : "location_error" });
      }
      return;
    }
    if (!this.valid(epoch)) return;
    if (!await this.identityCurrent(epoch, me)) return;
    // Consent is saved only after the explicit permission action and a fresh fix.
    // Reuse the accepted profile CAS; never opt into directory listing or eligibility.
    if (mode === "start" && this.view.exposureMode === "live" && !this.config) {
      const profile = await this.request<OwnSocialProfile>("/v1/me/social-profile");
      if (!this.valid(epoch)) return;
      if (!profile.ok) { this.busy = false; this.fail(profile); return; }
      if (!profile.data.socialEligible) {
        this.busy = false;
        this.set({ phase: "error", notice: "Для Radar нужен доступный профиль с именем. Проверьте свой профиль или откройте список игроков." });
        return;
      }
      const displayName = profile.data.displayName.trim() || me.displayName.trim();
      if (!displayName) {
        this.busy = false;
        this.set({ phase: "error", notice: "Для Radar нужен доступный профиль с именем. Проверьте свой профиль или откройте список игроков." });
        return;
      }
      const needsName = !profile.data.displayName.trim();
      const needsConsent = !profile.data.radarConsented || profile.data.radarConsentPolicyVersion !== previous?.policyVersion;
      if (needsName || needsConsent) {
        const consent = await this.request<OwnSocialProfile>("/v1/me/social-profile", {
          method: "PATCH", csrfToken: me.csrfToken,
          body: JSON.stringify({
            expectedVersion: profile.data.version,
            ...(needsName ? { displayName } : {}),
            ...(needsConsent ? { radarConsented: true, radarConsentPolicyVersion: previous?.policyVersion } : {}),
          }),
        });
        if (!this.valid(epoch)) return;
        if (!consent.ok) { this.busy = false; this.fail(consent); return; }
      }
    }
    this.set({ phase: "activating" });
    let path = "/v1/me/radar/activations", method = "POST";
    let body: object = { location: fix, consentPolicyVersion: previous?.policyVersion };
    if (previous?.state === "owned_elsewhere") { path = CURRENT + "/takeover"; body = { ...body, activationId: previous.activationId, expectedVersion: previous.version, confirm: true }; }
    else if (mode !== "start" && previous?.state === "active") { path = CURRENT + (mode === "renew" ? "/renew" : ""); method = mode === "location" ? "PATCH" : "POST"; body = { location: fix, activationId: previous.activationId, expectedVersion: previous.version }; }
    if (this.config) {
      const capability = this.config.unifiedDirectory;
      if (!this.config.publishingV2.enabled) { this.busy = false; this.set({ phase: "disabled" }); return; }
      const envelope = { contractVersion: UNIFIED_WIRE, consentPolicyVersion: capability.policyVersion };
      body = { ...body, ...envelope, ...(mode === "start" ? { consent: { disclosureId: capability.disclosure.id, disclosureHash: capability.disclosure.sha256, accepted: true } } : {}) };
    }
    this.mutationDispatched = true;
    const result = await this.request<RadarActivation>(path, { method, body: JSON.stringify(body), csrfToken: me.csrfToken });
    this.mutationDispatched = false;
    if (!this.valid(epoch)) { if (this.visible && !this.disposed) void this.reconcile(); return; }
    this.busy = false;
    if (!result.ok) {
      if (previous?.state === "active" && result.problem?.code === "RADAR_REGION_UNSUPPORTED") {
        await this.stop();
        if (this.view.phase !== "stopped") return;
      }
      this.fail(result); return;
    }
    if (!await this.identityCurrent(epoch, me)) return;
    if (mode === "start") { this.continuationConsented = true; this.intentUntil = this.duration === "until_off" ? Infinity : this.clock() + (this.duration === "1h" ? 60 : 15) * 60000; }
    this.accept(result.data);
    if (this.view.phase === "active" && this.resultView !== "none") {
      if (this.clock() >= this.nextRead && this.clock() >= this.retryAt) await this.nearby(epoch);
      else this.set({ loading: true });
    }
  }
  async permissionDenied() {
    if (this.view.exposureMode !== "live" || !this.visible || this.disposed || this.view.status?.state === "owned_elsewhere") return;
    if (this.view.status?.state === "active") {
      await this.stop();
      if (this.view.phase !== "stopped") return;
    } else {
      ++this.epoch; this.busy = false; this.clear();
    }
    this.set({ phase: "denied" });
  }
  async stop() {
    const status = this.view.status, me = this.view.me;
    if (!me || !status || !("activationId" in status) || this.view.phase === "stopping" || !this.visible) return;
    this.stopIntent = { activationId: status.activationId, userId: me.id, csrfToken: me.csrfToken };
    this.nextHeartbeat = Infinity;
    const epoch = ++this.epoch; this.busy = true; this.clear(); this.set({ phase: "stopping", pendingStop: true, notice: "Выключаем Radar…" });
    if (!await this.identityCurrent(epoch, me)) return;
    const r = await this.request<null>(CURRENT, { method: "DELETE", body: "{}", csrfToken: me.csrfToken, headers: { "X-Radar-Activation-Id": status.activationId } });
    if (!this.valid(epoch)) return;
    this.busy = false;
    if (!r.ok) { this.fail(r); this.set({ notice: "Не удалось подтвердить выключение. Проверьте статус." }); return; }
    this.stopIntent = null; this.intentUntil = Infinity; this.continuationConsented = false;
    this.set({
      phase: "stopped", confirmedOn: false, pendingStop: false, notice: "Radar выключен",
      status: {
        state: "off",
        ownerHere: false,
        policyVersion: status.policyVersion,
        exposureMode: status.exposureMode,
      },
    });
  }
  private async nearby(epoch: number) {
    const status = this.view.status;
    if (status?.state !== "active" || this.view.phase !== "active" || !this.valid(epoch)) return;
    this.nextRead = this.clock() + 30000; // Preserve cadence even for an unknown read outcome.
    this.busy = true; this.set({ loading: true });
    const r = await this.request<RadarNearby>("/v1/me/radar/nearby", { headers: { "X-Radar-Activation-Id": status.activationId } });
    if (!this.valid(epoch)) return;
    this.busy = false; this.set({ loading: false });
    if (!r.ok) { this.fail(r); return; }
    if (effectiveDeadline(status) <= this.clock()) { this.clear(); this.set({ phase: "expired", confirmedOn: false }); return; }
    this.freshUntil = Math.min(this.clock() + Math.max(0, r.data.displayTtlSeconds) * 1000, effectiveDeadline(status));
    this.nextRead = this.clock() + Math.max(1, r.data.refreshAfterSeconds) * 1000;
    // Renewed proof set invalidates any open contact/preview, even for the same player.
    const items = this.freshUntil > this.clock() && r.data.state === "results" ? r.data.items : [];
    const first = items.find(item => item.resultId === this.view.selected) ?? items[0];
    this.set({ items, selected: null, preview: null, previewLoading: false });
    if (first && this.resultView === "map") await this.select(first);
  }
  async select(item: RadarItem) {
    if (this.clock() < this.retryAt || this.view.phase !== "active" || this.clock() >= this.freshUntil || !this.view.me || !this.view.items.includes(item)) return;
    const epoch = this.epoch, selectionEpoch = ++this.selectionEpoch; this.set({ selected: item.resultId, preview: null, previewLoading: true, notice: "" });
    const r = await this.request<RadarPreview>("/v1/radar/results/preview", { method: "POST", body: JSON.stringify({ resultRef: item.resultRef }), csrfToken: this.view.me.csrfToken });
    if (!this.valid(epoch) || selectionEpoch !== this.selectionEpoch || this.view.selected !== item.resultId || !this.view.items.includes(item) || this.clock() >= this.freshUntil) return;
    this.set({ previewLoading: false });
    if (!r.ok) {
      if (r.status === 401) { this.fail(r); return; }
      if (r.status === 429) this.retryAt = this.clock() + (r.retryAfterSeconds ?? 60) * 1000;
      this.set({ selected: null, preview: null, notice: r.status === 429 ? "Radar обновляется слишком часто. Попробуйте позже." : "Игрок сейчас недоступен. Обновите Radar и попробуйте снова." }); return;
    }
    this.set({ preview: r.data });
  }
  tick() {
    if (!this.visible || this.disposed) return;
    this.set({});
    if (this.view.phase === "active" && this.clock() >= this.intentUntil) { void this.stop(); return; }
    if (this.view.status?.state === "active" && !this.view.pendingStop && !["permission", "stopping", "background", "checking"].includes(this.view.phase) && effectiveDeadline(this.view.status) <= this.clock()) {
      ++this.epoch; this.busy = false; this.continuationConsented = false; this.clear(); this.set({ phase: "checking", notice: "Radar завершён. Проверяем статус…" }); void this.reconcile(); return;
    }
    if (this.freshUntil && this.freshUntil <= this.clock()) this.clear();
    if (this.view.phase !== "active" || this.busy || this.clock() < this.retryAt) return;
    const active = this.view.status;
    // Continue only an explicit in-memory long-duration intent, in foreground,
    // while every lease is still valid. Never acquire GPS automatically.
    if (this.continuationConsented && this.intentUntil > this.clock()) {
      if (active?.state === "active" && this.duration !== "15m" && Date.parse(active.expiresAt) - this.clock() <= 60000 && Date.parse(active.hardExpiresAt) > Date.parse(active.expiresAt) && this.clock() < Date.parse(active.nextLocationUpdateAt)) {
        void this.activate(() => Promise.reject({ code: 2 }), "renew"); return;
      }
    }
    if (this.clock() >= this.nextHeartbeat) { void this.pulse(); return; }
    if (this.resultView !== "none" && this.clock() >= this.nextRead) void this.nearby(this.epoch);
  }
  private async pulse() {
    const status = this.view.status, me = this.view.me, epoch = this.epoch;
    if (status?.state !== "active" || !me) return;
    this.busy = true;
    // Identity is checked before each foreground pulse; account changes never inherit Radar.
    const identity = await this.request<Me>("/v1/me");
    if (!this.valid(epoch)) return;
    if (!identity.ok || identity.data.id !== me.id || identity.data.csrfToken !== me.csrfToken) { this.busy = false; ++this.epoch; this.continuationConsented = false; this.clear(); this.set({ me: null, status: null, confirmedOn: false, pendingStop: false }); await this.reconcile(); return; }
    const r = await this.request<RadarActivation>(CURRENT + "/heartbeat", { method: "POST", body: JSON.stringify({ activationId: status.activationId, ...(status.contractVersion === UNIFIED_WIRE ? { contractVersion: UNIFIED_WIRE, consentPolicyVersion: status.policyVersion } : {}) }), csrfToken: me.csrfToken });
    if (!this.valid(epoch)) return;
    this.busy = false;
    if (!r.ok) { this.fail(r); return; }
    this.accept(r.data);
  }
  visibility(visible: boolean) {
    this.visible = visible; ++this.epoch; this.busy = false; this.clear();
    if (!visible) this.set({ phase: "background" }); else void this.reconcile();
  }
  dispose() { this.disposed = true; ++this.epoch; this.clear(); this.listeners.clear(); }
}
