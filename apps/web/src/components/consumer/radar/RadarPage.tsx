"use client";
import type { Map as LibreMap } from "maplibre-gl";
import { GamesMapView } from "../games/GamesMapView";
import { GamesMapViewport } from "../games/GamesMapViewport";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { MOSCOW_BUNDLE, candidateMapConfigAllowed } from "../../../lib/radar-map-assets";
import { distanceText } from "../../../lib/unified-directory";
import { Button } from "../Button";
import { RadarStatusAffordance } from "./RadarSessionProvider";
import { UnifiedPlayerPreview } from "./UnifiedPlayerPreview";
import { useRadarSession, useUnifiedDirectory, useRadarConfig, useDirectoryFilters } from "./RadarSessionProvider";
import "../../../styles/radar-geographic.css";
const GeographicRadarMap = dynamic(() => import("./GeographicRadarMap").then(m => m.GeographicRadarMap), { ssr: false });
export function RadarPage({ sharedMap, resumeCamera = false }: { sharedMap?: LibreMap; resumeCamera?: boolean } = {}) {
  const { view: session } = useRadarSession(); const { controller, view } = useUnifiedDirectory();
  const [failed, setFailed] = useState(false); const [listOpen, setListOpen] = useState(false); const [expanded, setExpanded] = useState(false);
  const [candidate, setCandidate] = useState(false); const sheet = useRef<HTMLElement>(null); const touchY = useRef<number | null>(null); const trigger = useRef<HTMLElement | null>(null);
  const snapshot = view.snapshot;
  // Keep the map marker identity stable between one-second header ticks;
  // the exact-deadline timer below invalidates this array when a lease expires.
  const safeMapPins = useMemo(() => view.pins.filter(row => row.radar &&
    Date.parse(row.radar.validUntil) > Date.now()), [view.pins]);
  const privateMapDeadline = Math.min(...view.pins.filter(row => row.radar)
    .map(row => Date.parse(row.radar!.validUntil)), Infinity);
  useEffect(() => {
    if (!sharedMap || !controller || !Number.isFinite(privateMapDeadline)) return;
    const timer = window.setTimeout(() => controller.tick(), Math.max(0, privateMapDeadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [controller, privateMapDeadline]);
  const config = useRadarConfig(); const { filters } = useDirectoryFilters();
  const cityId = filters.cityId || config?.cities.find(c => c.cityId === MOSCOW_BUNDLE.cityId)?.cityId;
  const activationId = session.phase === "active" && session.confirmedOn && session.status?.state === "active" && session.status.contractVersion === "players-unified-radar-v1" && !session.pendingStop ? session.status.activationId : null;
  const activationKey = activationId && session.status && "version" in session.status ? `${activationId}:${session.status.version}` : null;
  const queryFilters = { cityId: cityId ?? "", areaKey: filters.areaKey.trim() || undefined, name: filters.name.trim().length >= 2 ? filters.name.trim() : undefined, looking: filters.lookingOnly || undefined, trainer: filters.trainerOnly || undefined };
  const filterKey = JSON.stringify(queryFilters);
  useEffect(() => {
    if (!sharedMap || !controller || !activationId || !cityId || !config?.unifiedDirectory.enabled || !config.cities.some(c => c.cityId === cityId)) return;
    const recover = () => { const current = controller.snapshot(); if (!current.busy && !current.capabilityUnavailable && !current.authenticationRequired && !controller.matches(queryFilters, activationKey)) void controller.query(queryFilters, { kind: "current_activation", activationId }, activationKey); };
    recover(); const timer = setInterval(recover, 30000); return () => clearInterval(timer);
  }, [controller, activationKey, filterKey, config]);

  useEffect(() => {
    if (sharedMap) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [sharedMap]);
  useEffect(() => {
    if (sharedMap) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open], [role=dialog]")) return;
      document.querySelector<HTMLAnchorElement>(".gb-shared-fullscreen .gb-map-return")?.click();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [sharedMap]);
  // Public DEV basemap registration is independent of expiring private
  // query tokens. Never use stale queries to authorize Radar pins.
  useEffect(() => {
    setCandidate(candidateMapConfigAllowed(config, cityId, window.location.origin) && Boolean(session.me));
    setFailed(false);
  }, [config, cityId, session.me?.id]);
  useEffect(() => {
    if (sharedMap && candidate && controller && snapshot && !view.mapPage && !view.busy) void controller.map();
  }, [candidate, controller, snapshot?.query.queryRef, view.mapPage, view.busy]);
  useEffect(() => { if (!sharedMap) return; if (view.selected) { setExpanded(false); } else { if (trigger.current?.isConnected) trigger.current.focus(); } }, [view.selected]);
  useEffect(() => { if (listOpen) sheet.current?.focus(); }, [listOpen]);
  useEffect(() => {
    if (!sharedMap || !view.selected) return;
    window.history.pushState({ ...window.history.state, gbRadarPreview: true }, "", window.location.href);
    const back = () => { controller?.close(); setListOpen(false); setExpanded(false); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [view.selected, controller]);
  useEffect(() => {
    if (!sharedMap || !controller || !activationId) return;
    // Keep the existing bounded page-window API. Panning or PageDown exposes
    // the next window without adding a permanent map control or accumulating pins.
    const next = () => { const current = controller.snapshot(); if (!current.busy && current.mapPage?.nextMapCursor) void controller.map(true); };
    const key = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open], [role=dialog]")) return;
      if (event.key === "PageDown") { event.preventDefault(); next(); }
      if (event.key.toLowerCase() === "l") { trigger.current = document.activeElement as HTMLElement; controller.close(); setListOpen(true); }
    };
    const canvas = sharedMap.getCanvas();
    canvas.setAttribute("aria-description", "Стрелки перемещают карту. PageDown — следующие участники Radar. L — список участников на карте.");
    canvas.addEventListener("keydown", key); sharedMap.on("dragend", next);
    return () => { canvas.removeEventListener("keydown", key); sharedMap.off("dragend", next); canvas.removeAttribute("aria-description"); };
  }, [sharedMap, controller, activationId]);
  const mapped = candidate && !failed && controller && session.me;
  function close() { if (window.history.state?.gbRadarPreview) window.history.back(); controller?.close(); setListOpen(false); setExpanded(false); requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }); }
  const mapLayer = mapped && sharedMap ? <GeographicRadarMap resumeCamera={resumeCamera} sharedMap={sharedMap} controller={controller} rows={session.phase === "active" && session.confirmedOn && !session.pendingStop ? safeMapPins : []} selected={view.selected} onSelect={row => { trigger.current = document.activeElement as HTMLElement; setListOpen(false); void controller.select(row); }} onUnavailable={() => setFailed(true)} /> : null;
  if (!sharedMap) return <main id="gb-main" className="gb-consumer g2-radar-map gb-shared-fullscreen" aria-label="Карта игр, площадок и Radar"><GamesMapViewport fullscreen><GamesMapView cityId={cityId ?? MOSCOW_BUNDLE.cityId} day="" /></GamesMapViewport><Link className="gb-map-return" href="/players" onClick={() => window.dispatchEvent(new Event("gb-map-return"))}><span aria-hidden="true">←</span>К списку</Link><div className="gb-map-radar"><RadarStatusAffordance mapControls /></div></main>;
  return <div className="gb-consumer gb-radar-layer fr3" aria-label="Карта участников Radar">
    {mapLayer}
    {failed && <p role="alert" className="gb-map-position-unavailable">Не удалось загрузить участников Radar. Площадки и игры остаются на карте.</p>}
    {session.confirmedOn && session.status?.state === "active" && !session.status.coarseCenter && <p role="status" className="gb-map-position-unavailable">Опубликованная геопозиция недоступна. Площадки города остаются на карте.</p>}
    {mapped && <><div hidden className="g2-map-summary gb-map-layer-summary"><button aria-expanded={listOpen} aria-controls="g2-map-panel" onClick={() => { trigger.current = document.activeElement as HTMLElement; if (!listOpen) controller.close(); setListOpen(!listOpen); }}>{view.busy ? "Загружаем игроков…" : `На карте: ${view.pins.length} из ${snapshot?.totals.radarTotal ?? 0}`}</button><small>Приблизительные геопозиции. {view.mapPage?.hasMore ? "Показана часть участников." : ""}</small>{view.mapPage?.nextMapCursor && <Button variant="outline" disabled={view.busy} onClick={() => void controller.map(true)}>Следующие точки</Button>}{view.notice && <small role="status">{view.notice}</small>}</div>
      {!sharedMap && !view.busy && !view.pins.length && <p className="g2-map-empty" role="status">{view.stale || !snapshot ? "Обновляем участников Radar. Карта города доступна." : "Нет участников с геопозицией. Обычные профили доступны в списке."}</p>}
      {(listOpen || view.selected) && <aside id="g2-map-panel" ref={sheet} tabIndex={-1} aria-label="Игроки на карте" className={`g2-map-panel ${expanded || listOpen ? "is-expanded" : ""}`} onKeyDown={e => { if (e.key === "Escape" && !(e.target as Element).closest("dialog")) { e.stopPropagation(); close(); } }}>
        <header onTouchStart={e => { touchY.current = e.touches[0]?.clientY ?? null; }} onTouchEnd={e => { const y = e.changedTouches[0]?.clientY; if (touchY.current !== null && y !== undefined) { if (y - touchY.current > 70) setExpanded(false); if (touchY.current - y > 70) setExpanded(true); } touchY.current = null; }}><button aria-label={expanded ? "Свернуть карточку" : "Развернуть карточку"} aria-expanded={expanded} className="g2-sheet-handle" onClick={() => setExpanded(!expanded)}>—</button><button aria-label="Закрыть карточку игрока" onClick={close}>×</button></header>
        {view.selected ? <UnifiedPlayerPreview dialog onClose={close} /> : <><h2>Игроки на карте</h2>{view.pins.map(row => <button className="g2-map-list-row" key={row.publicPlayerId} onClick={() => { trigger.current = document.activeElement as HTMLElement; setListOpen(false); void controller.select(row); }}><strong>{row.player.displayName}</strong><small>{distanceText(row.radar?.distance ?? null) ?? "Расстояние неизвестно"}</small></button>)}</>}
      </aside>}
    </>}
  </div>;
}
