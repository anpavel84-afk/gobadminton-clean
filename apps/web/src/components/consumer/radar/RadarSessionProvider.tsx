"use client";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { radarHeaderStatus, radarRingFraction } from "../../../lib/radar-header";
import { RadarController, type RadarView } from "../../../lib/radar-controller";
import { confirmedSessionDeadline, remainingTime } from "../../../lib/radar-presentation";
import { Button } from "../Button";
import { AuthEntry, ProfileDialog } from "../players/ProfileComposition";
import {
  clearRadarPreparedMedia,
  prewarmRadarPeerMedia,
  selectRadarMediaPrewarmPeers,
} from "../players/PlayerBrowseMedia";
import { syntheticDemoFix } from "../../../lib/radar-demo-fix";
import { apiFetch } from "../../../lib/api-client";
import { devMoscowFix, usesDevMoscowLocation } from "../../../lib/radar-dev-moscow";
import { UnifiedDirectoryController, compatibleRadarConfig, type RadarConfig } from "../../../lib/unified-directory";
import type { OwnSocialProfile, PublicPlayer } from "../../../lib/consumer-types";
import { isAdmittedDemoCity } from "../../../lib/radar-demo-fix";
import type { RadarFix } from "../../../lib/radar-types";

export type DirectoryFilters = { name: string; areaKey: string; cityId: string; lookingOnly: boolean; trainerOnly: boolean };
const emptyFilters: DirectoryFilters = { name: "", areaKey: "", cityId: "", lookingOnly: false, trainerOnly: false };
const Directory = createContext({ filters: emptyFilters, update: (_patch: Partial<DirectoryFilters>) => {} });
export const useDirectoryFilters = () => useContext(Directory);
const Unified = createContext<UnifiedDirectoryController | null>(null);
const Configuration = createContext<RadarConfig | null>(null);
export const useRadarConfig = () => useContext(Configuration);
const emptyUnified = new UnifiedDirectoryController().snapshot();
export function useUnifiedDirectory() {
  const controller = useContext(Unified);
  const view = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.snapshot ?? (() => emptyUnified), () => emptyUnified);
  return { controller, view };
}
const Session = createContext<RadarController | null>(null);
const cold: RadarView = { phase: "checking", me: null, status: null, items: [], loading: false, selected: null, preview: null, previewLoading: false, notice: "", now: 0, exposureMode: null, demoCityId: null, confirmedOn: false, pendingStop: false };
const noopSubscribe = () => () => {};
export function useRadarSession() {
  const controller = useContext(Session);
  const view = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.snapshot ?? (() => cold), () => cold);
  return { controller, view };
}
export function RadarSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [filters, setFilters] = useState(emptyFilters);
  const [unified, setUnified] = useState<UnifiedDirectoryController | null>(null);
  const [config, setConfig] = useState<RadarConfig | null>(null);
  const [controller, setController] = useState<RadarController | null>(null);
  // Root client boundary persists across consumer navigation; never a server singleton.
  useEffect(() => {
    const c = new RadarController(); c.setResultView("none"); setController(c);
    const directory = new UnifiedDirectoryController(); setUnified(directory);
    let identityKey = ""; let configEpoch = 0; let wasOn = false;
    let retired = false;
    let configAbort = new AbortController();
    const syncSession = () => {
      if (retired) return;
      const view = c.snapshot();
      // Identity reconciliation briefly clears /me before reading it again.
      // A feature 401 already cleared private rows and disabled actions; keep
      // that recovery through the transient null, including CSRF rotation.
      // Guest or a different confirmed actor still resets the binding.
      if (view.me || !directory.view.authenticationRequired || view.phase === "guest") directory.bind(view.me);
      if (view.pendingStop || (wasOn && (!view.confirmedOn || ["error", "owned_elsewhere", "expired", "guest"].includes(view.phase)))) directory.ordinary();
      wasOn = view.confirmedOn;
      const key = view.me ? `${view.me.id}:${view.me.csrfToken}` : "";
      if (key === identityKey) return;
      identityKey = key; const epoch = ++configEpoch; configAbort.abort(); configAbort = new AbortController(); setConfig(null); c.configure(null);
      if (!view.me) return;
      const signal = configAbort.signal;
      void apiFetch<unknown>("/v1/radar/config", { signal }).then(async result => {
        if (epoch !== configEpoch || !result.ok || signal.aborted) return;
        const supported = compatibleRadarConfig(result.data);
        if (!supported) return;
        let demoCityId: string | null = null;
        if (supported.exposureMode === "synthetic_demo") {
          const profile = await apiFetch<OwnSocialProfile>("/v1/me/social-profile", { signal });
          if (epoch !== configEpoch || signal.aborted) return;
          if (profile.ok && isAdmittedDemoCity(profile.data.cityId)) demoCityId = profile.data.cityId;
        }
        setConfig(supported); c.configure(supported, demoCityId);
      });
    };
    const unsubscribe = c.subscribe(syncSession);
    const visibility = () => { directory.visibility(!document.hidden); c.visibility(!document.hidden); };
    const hidden = () => { directory.visibility(false); c.visibility(false); };
    // A session event is a fence, even while the first /me is unresolved.
    // Retire the whole controller so its private epochs, CSRF and stop intents
    // cannot flow into the replacement session through an old network response.
    const identity = () => {
      retired = true; ++configEpoch; configAbort.abort();
      directory.dispose(); c.dispose();
      setConfig(null); setUnified(null); setController(null); setFilters(emptyFilters);
      setSessionEpoch(previous => previous + 1);
    };
    // Feature 401 is not proof of an account transition. Keep its recovery
    // state while independently checking /me; a real session event retires it.
    const expired = () => { void c.checkIdentity(); };
    const timer = setInterval(() => { c.tick(); directory.tick(); }, 1000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", visibility); window.addEventListener("pagehide", hidden);
    window.addEventListener("gb-session-changed", identity);
    window.addEventListener("gb-private-expired", expired);
    visibility();
    return () => { retired = true; clearInterval(timer); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pageshow", visibility); window.removeEventListener("pagehide", hidden); window.removeEventListener("gb-session-changed", identity); window.removeEventListener("gb-private-expired", expired); ++configEpoch; configAbort.abort(); unsubscribe(); directory.dispose(); c.dispose(); };
  }, [sessionEpoch]);
  useEffect(() => {
    if (!controller) return;
    // Unified directory owns results; keep resultView none across consumer routes.
    controller.setResultView("none");
  }, [controller]);
  useEffect(() => {
    if (!controller) return;
    // Identity fence on real route changes only — venue/game panel overlays must not
    // re-enter checkIdentity and disturb an authorized Radar window.
    void controller.checkIdentity();
  }, [controller, pathname]);
  return <Session.Provider value={controller}><Unified.Provider value={unified}><Configuration.Provider value={config}><Directory.Provider value={{ filters, update: patch => setFilters(previous => ({ ...previous, ...patch })) }}><RadarPermissionObserver /><RadarAuthorizedMediaPrewarm />{children}</Directory.Provider></Configuration.Provider></Unified.Provider></Session.Provider>;
}
/**
 * Owns bounded Radar peer media lifecycle ahead of map/profile open.
 * UnifiedPlayerPreview only consumes prepared nodes — it must not be the sole warmer.
 */
function RadarAuthorizedMediaPrewarm() {
  const directory = useUnifiedDirectory();
  const { view } = useRadarSession();
  const activation = view.status?.state === "active" && view.confirmedOn && !view.pendingStop
    ? view.status
    : null;
  const activationId = activation?.activationId ?? null;
  const activationVersion = activation && "version" in activation ? activation.version : null;
  useEffect(() => {
    const me = view.me;
    const snapshot = directory.view.snapshot;
    const authorized = Boolean(
      me
      && activation
      && directory.view.mode === "unified"
      && !directory.view.stale
      && !directory.view.authenticationRequired
      && !directory.view.capabilityUnavailable
      && snapshot
      && Number.isFinite(Date.parse(snapshot.validUntil))
      && Date.parse(snapshot.validUntil) > Date.now(),
    );
    if (!authorized || !me || !activation) {
      clearRadarPreparedMedia();
      return;
    }
    const now = Date.now();
    const peers = [...directory.view.pins, ...directory.view.rows].filter(row =>
      row.radar && Number.isFinite(Date.parse(row.radar.validUntil)) && Date.parse(row.radar.validUntil) > now);
    const deduped: typeof peers = [];
    const seen = new Set<string>();
    for (const row of peers) {
      if (seen.has(row.publicPlayerId)) continue;
      seen.add(row.publicPlayerId);
      deduped.push(row);
    }
    const selectedId = directory.view.selected;
    const neighborhood = selectRadarMediaPrewarmPeers(deduped, selectedId, 4);
    const keep = new Set(neighborhood.map(row => row.publicPlayerId));
    clearRadarPreparedMedia(id => keep.has(id));
    const sessionKey = `${me.id}:${me.csrfToken}:${activation.activationId}:${"version" in activation ? activation.version : 0}`;
    for (const row of neighborhood) {
      // Public GET cover metadata for known authorized peers — not private proofs.
      prewarmRadarPeerMedia(row.player as PublicPlayer, {
        resolveCover: true,
        sessionKey,
      });
    }
  }, [
    directory.view.pins,
    directory.view.rows,
    directory.view.selected,
    directory.view.snapshot?.query.queryRef,
    directory.view.snapshot?.validUntil,
    directory.view.mode,
    directory.view.stale,
    directory.view.authenticationRequired,
    directory.view.capabilityUnavailable,
    view.me?.id,
    view.me?.csrfToken,
    activationId,
    activationVersion,
  ]);
  return null;
}
function RadarPermissionObserver() {
  const { controller, view } = useRadarSession();
  const config = useRadarConfig();
  useEffect(() => {
    if (!controller || usesDevMoscowLocation(config, window.location.origin) || view.exposureMode !== "live" || !navigator.permissions) return;
    let cancelled = false; let permission: PermissionStatus | undefined;
    const changed = () => { if (permission?.state === "denied") void controller.permissionDenied(); };
    void navigator.permissions.query({ name: "geolocation" }).then(p => { if (cancelled) return; permission = p; p.addEventListener("change", changed); changed(); }).catch(() => {});
    return () => { cancelled = true; permission?.removeEventListener("change", changed); };
  }, [controller, config, view.exposureMode, view.confirmedOn]);
  return null;
}
/** Single owner-approved Radar control for desktop, mobile and map header.
 * Public circular countdown is strictly projected from authoritative status;
 * the popover owns explicit start/renew/stop actions, never automatic GPS. */
export function RadarStatusAffordance({ mapControls = false }: { mapControls?: boolean } = {}) {
  const { controller, view } = useRadarSession();
  const directory = useUnifiedDirectory();
  const config = useRadarConfig();
  const status = radarHeaderStatus(view);
  const popupId = useId();
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Once per confirmed activation generation: expiry warning at <=60s (header overlay only).
  // Dismissal is sticky for that key — ordinary phase/now pulses must not reopen it.
  const warnedExpiryKey = useRef<string | null>(null);
  const [expiryPrompt, setExpiryPrompt] = useState<{ key: string; until: number } | null>(null);
  const activation = view.status?.state === "active" ? view.status : null;
  const running = view.phase === "active" && Boolean(activation) && view.confirmedOn;
  const progress = radarRingFraction(view);
  const circumference = 2 * Math.PI * 21;
  const busy = ["checking", "permission", "locating", "activating", "stopping", "background"].includes(view.phase);
  const canStart = Boolean(controller && config?.publishingV2.enabled && !busy &&
    ["off", "stopped", "expired", "denied", "location_error", "owned_elsewhere"].includes(view.phase));
  const canRenew = Boolean(running && activation && Date.parse(activation.hardExpiresAt) > Date.parse(activation.expiresAt));
  const needsLocation = Boolean(running && activation && view.now >= Date.parse(activation.nextLocationUpdateAt));
  const canStop = Boolean(controller && view.me && view.status && "activationId" in view.status && !busy);
  const sessionUntil = running && activation ? confirmedSessionDeadline(activation) : NaN;
  const remaining = running && activation && Number.isFinite(sessionUntil)
    ? remainingTime(new Date(sessionUntil).toISOString(), view.now) : null;
  const caption = status?.text ?? (view.phase === "guest" ? "Войдите для Radar" : view.phase === "disabled" ? "Radar недоступен" : view.phase === "error" ? "Статус Radar неизвестен" : ["checking", "locating", "activating", "stopping"].includes(view.phase) ? "Проверяем Radar…" : "Radar выключен");
  const directoryNotice = directory.view.notice;
  const distanceNotice = directoryNotice.startsWith("Расстояние приблизительное")
    || directoryNotice.startsWith("Участники Radar по городу");
  const diagnostic =
    view.phase === "denied" ? "Доступ к геолокации запрещён. Разрешите его в настройках браузера." :
    view.phase === "location_error" ? "Не удалось определить геопозицию. Проверьте разрешения и попробуйте снова." :
    view.phase === "disabled" ? "Radar сейчас недоступен. Обычный каталог работает." :
    view.phase === "error" ? (view.notice || "Не удалось проверить Radar. Повторите проверку статуса.") :
    view.pendingStop || view.phase === "stopping" ? "Ожидаем подтверждения выключения Radar." :
    view.phase === "background" ? "Radar приостановлен, пока приложение неактивно." :
    view.phase === "expired" ? "Сессия завершена. Включите Radar снова." :
    directory.view.authenticationRequired ? "Войдите снова, чтобы смотреть участников Radar." :
    // Transient/stale unified notices belong in the header, not the /players in-flow strip.
    directoryNotice && !distanceNotice ? directoryNotice : "";
  useEffect(() => {
    if (!running || !activation || !Number.isFinite(sessionUntil)) {
      if (!running) { warnedExpiryKey.current = null; setExpiryPrompt(null); }
      return;
    }
    const key = `${activation.activationId}:${activation.expiresAt}`;
    const remainingMs = sessionUntil - view.now;
    if (remainingMs > 60000 || remainingMs <= 0) {
      if (remainingMs <= 0) setExpiryPrompt(null);
      return;
    }
    // One terminal warning per actual session expiry key (including hard-cap / cannot renew).
    if (warnedExpiryKey.current === key) return;
    warnedExpiryKey.current = key;
    setExpiryPrompt({ key, until: sessionUntil });
  }, [running, activation, sessionUntil, view.now]);
  const showExpiry = Boolean(expiryPrompt && running && expiryPrompt.key === `${activation?.activationId}:${activation?.expiresAt}`);
  useEffect(() => {
    if (!open && !showExpiry) return;
    const dismissOverlay = () => {
      setOpen(false);
      setExpiryPrompt(null);
      trigger.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) dismissOverlay();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]") && !(event.target instanceof Element && event.target.closest("[role=dialog]") && !host.current?.contains(event.target))) {
        event.preventDefault();
        dismissOverlay();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, showExpiry]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div ref={host} className="gb-radar-indicator" data-tone={status?.tone ?? "off"}>
    <button ref={trigger} type="button" className="gb-radar-indicator__link"
      aria-label={caption + ". Открыть управление Radar"} aria-haspopup="dialog"
      aria-expanded={open || showExpiry} aria-controls={open || showExpiry ? popupId : undefined}
      onClick={() => { setOpen(value => !value); if (showExpiry) setExpiryPrompt(null); }}>
      <svg aria-hidden="true" viewBox="0 0 48 48" className="gb-radar-symbol">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3.5" opacity=".13"/>
        {running && <circle className="gb-radar-progress" cx="24" cy="24" r="21" fill="none"
          stroke="#8DE126" strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)}
          transform="rotate(-90 24 24)"/>}
        <circle className="gb-radar-symbol__disc" cx="24" cy="24" r="16" />
        <g className="gb-radar-symbol__glyph" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="24" cy="24" r="11"/><circle cx="24" cy="24" r="6"/>
          <path d="M24 24L31 17"/><circle cx="24" cy="24" r="1.3" fill="currentColor"/>
        </g>
      </svg>
    </button>
    {showExpiry && !open && <div id={popupId} className="gb-radar-expiry-warn" role="status">
      <p>Сессия Radar скоро закончится ({remaining}).</p>
      <div className="gb-radar-expiry-warn__actions">
        {canRenew
          ? <Button disabled={!controller || busy} onClick={() => { setExpiryPrompt(null); if (controller) void controller.activate(() => acquireRadarLocation(controller), "renew"); }}>Продлить</Button>
          : <p>Продление недоступно — достигнут предельный срок сессии.</p>}
        <Button variant="ghost" onClick={() => setExpiryPrompt(null)}>Скрыть</Button>
      </div>
    </div>}
    {open && <section id={popupId} className="gb-radar-popover" role="dialog" aria-label="Управление Radar">
      <strong>{caption}</strong>
      {running && <><p role="status">Radar включён. Участники видят только приблизительное положение. Обновляйте геопозицию и продлевайте сессию на этом экране.</p><div className="gb-radar-popover__time" aria-live="off">
        <b>{remaining}</b><small>до окончания подтверждённой сессии</small>
      </div><div className="gb-radar-popover__track" aria-hidden="true"><span style={{ width: String(Math.round(progress * 100)) + "%" }}/></div></>}
      {diagnostic && <p role="status">{diagnostic}</p>}
      {needsLocation && <p role="status">Обновите геопозицию, чтобы Radar продолжал показывать участников.</p>}
      {view.phase === "owned_elsewhere" && <p>Radar работает на другом устройстве. Можно перенести его сюда.</p>}
      <div className="gb-radar-popover__actions">
        {mapControls && running && !view.pendingStop && <Button variant="outline" disabled={!directory.controller || !directory.view.snapshot} aria-controls="g2-map-panel" onClick={() => { close(); window.dispatchEvent(new Event("gb-radar-map-list")); }}>Список участников</Button>}
        {mapControls && running && !view.pendingStop && directory.view.mapPage?.nextMapCursor && <Button variant="outline" disabled={directory.view.busy || !directory.controller} onClick={() => { if (directory.controller) void directory.controller.map(true); }}>Следующие точки</Button>}
        {view.phase === "guest" ? <AuthEntry returnPath="/players">Войти для Radar</AuthEntry> :
          running ? <>
            {canRenew && <Button disabled={!controller || busy} onClick={() => { setExpiryPrompt(null); close(); if (controller) void controller.activate(() => acquireRadarLocation(controller), "renew"); }}>Продлить</Button>}
            {needsLocation && <Button variant="outline" disabled={!controller || busy} onClick={() => { close(); if (controller) void controller.activate(() => acquireRadarLocation(controller), "location"); }}>Обновить позицию</Button>}
            <Button variant="outline" disabled={!canStop} onClick={() => { close(); if (controller) void controller.stop(); }}>Выключить</Button>
          </> : <>
            {view.confirmedOn && canStop && <Button variant="outline" onClick={() => { close(); if (controller) void controller.stop(); }}>Выключить</Button>}
            {!view.confirmedOn && <Button disabled={!canStart} onClick={() => { close(); controller?.permission(); }}>Включить Radar</Button>}
            {view.phase === "error" && <Button variant="outline" onClick={() => { close(); if (controller) void controller.reconcile(); }}>Проверить статус</Button>}
            {view.phase === "denied" && <Button variant="outline" onClick={() => { close(); controller?.permission(); }}>Попробовать снова</Button>}
            {view.phase === "location_error" && <Button variant="outline" onClick={() => { close(); controller?.permission(); }}>Попробовать снова</Button>}
            {view.phase === "owned_elsewhere" && <Button disabled={!canStart} onClick={() => { close(); controller?.permission(); }}>Перенести сюда</Button>}
            {directory.view.authenticationRequired && <AuthEntry returnPath="/players">Войти для Radar</AuthEntry>}
          </>}
      </div>
    </section>}
    {view.phase === "permission" && controller && <div className="fr3"><ProfileDialog title="Включить Radar и поделиться геопозицией?"
      onClose={() => controller.cancel()}>
      <p>{config?.unifiedDirectory.disclosure.text ?? "Radar сейчас недоступен. Можно пользоваться обычным каталогом."}</p>
      {view.status?.state === "owned_elsewhere" && <p>В другой сессии Radar выключится.</p>}
      <RadarDurationChoice />
      <div className="profile-form-actions radar-consent-actions">
        <Button block disabled={!config?.publishingV2.enabled}
          onClick={() => void controller.activate(() => acquireRadarLocation(controller))}>
          {view.status?.state === "owned_elsewhere" ? "Перенести и включить" : "Согласен, включить Radar"}
        </Button>
        <Button variant="ghost" onClick={() => controller.cancel()}>Отмена</Button>
      </div>
    </ProfileDialog></div>}
  </div>;
}
/** Called only by an explicit foreground intent. Synthetic never falls through to GPS. */
export function acquireRadarLocation(controller: RadarController): Promise<RadarFix> {
  const view = controller.snapshot();
  if (document.hidden || compatibleRadarConfig(controller.config)?.publishingV2.enabled !== true) return Promise.reject({ code: 2 });
  if (view.exposureMode === "synthetic_demo") return controller.usesSyntheticLocation() && view.demoCityId ? Promise.resolve(syntheticDemoFix(view.demoCityId)) : Promise.reject({ code: 2 });
  const testFix = view.me ? devMoscowFix(compatibleRadarConfig(controller.config), window.location.origin) : null;
  if (view.exposureMode === "live" && testFix) return Promise.resolve(testFix);
  if (view.exposureMode !== "live" || !window.isSecureContext || !navigator.geolocation) return Promise.reject({ code: 2 });
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyMeters: p.coords.accuracy, capturedAt: new Date(p.timestamp).toISOString() }), reject, { maximumAge: 0, timeout: 15000, enableHighAccuracy: false }));
}

/** Local intent only: no duration field is sent to the lease API. */
export function RadarDurationChoice() {
  const { controller } = useRadarSession();
  return <div className="radar-duration"><label>Желаемое время Radar
    <select value={controller?.duration ?? "15m"} onChange={event => {
      const value = event.target.value;
      if (value === "15m" || value === "1h" || value === "until_off") controller?.chooseDuration(value);
    }}><option value="15m">15 минут</option><option value="1h">1 час</option><option value="until_off">До выключения</option></select>
  </label><p>Это намерение, а не бессрочная сессия. Сервер ограничивает срок и свежесть геопозиции. Допустимое продление выполняется только на переднем плане со свежей геопозицией; после истечения потребуется снова включить Radar с согласием. При перезагрузке проверим серверный срок.</p></div>;
}
