"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { radarHeaderStatus } from "../../../lib/radar-header";
import { RadarController, type RadarView } from "../../../lib/radar-controller";
import { syntheticDemoFix } from "../../../lib/radar-demo-fix";
import { apiFetch } from "../../../lib/api-client";
import { devMoscowFix, usesDevMoscowLocation } from "../../../lib/radar-dev-moscow";
import { UnifiedDirectoryController, compatibleRadarConfig, type RadarConfig } from "../../../lib/unified-directory";
import type { OwnSocialProfile } from "../../../lib/consumer-types";
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
      if (view.pendingStop || (wasOn && !view.confirmedOn)) directory.ordinary();
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
    controller.setResultView("none");
    void controller.checkIdentity();
  }, [controller, pathname]);
  return <Session.Provider value={controller}><Unified.Provider value={unified}><Configuration.Provider value={config}><Directory.Provider value={{ filters, update: patch => setFilters(previous => ({ ...previous, ...patch })) }}><RadarPermissionObserver />{children}</Directory.Provider></Configuration.Provider></Unified.Provider></Session.Provider>;
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
export function RadarStatusAffordance() {
  const { view } = useRadarSession();
  const status = radarHeaderStatus(view); const id = useId();
  const [open, setOpen] = useState(false);
  if (!status) return null;
  return <span className="gb-radar-indicator" data-tone={status.tone} onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
    <Link className="gb-radar-indicator__link" href="/players" aria-label={`${status.text}. Перейти к управлению радаром`} aria-describedby={open ? id : undefined}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } }}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 12 19 5" /><circle cx="12" cy="12" r="1" /></svg>
    </Link>
    {open && <span id={id} role="tooltip" className="gb-radar-tooltip">{status.text}{status.until && <small>До {new Date(status.until).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</small>}</span>}
  </span>;
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
