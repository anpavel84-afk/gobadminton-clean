"use client";
import { CloseButton } from "../CloseButton";
import type { Map as LibreMap } from "maplibre-gl";
import { GamesMapView } from "../games/GamesMapView";
import { GamesMapViewport } from "../games/GamesMapViewport";
import { VenuePopup } from "../games/VenuePopup";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { MOSCOW_BUNDLE, candidateMapConfigAllowed } from "../../../lib/radar-map-assets";
import { distanceText } from "../../../lib/unified-directory";
import { Button } from "../Button";
import { RadarStatusAffordance } from "./RadarSessionProvider";
import { UnifiedPlayerPreview } from "./UnifiedPlayerPreview";
import { RadarMapModuleLoading } from "./RadarMapModuleLoading";
import { useRadarSession, useUnifiedDirectory, useRadarConfig, useDirectoryFilters } from "./RadarSessionProvider";
import { useMapLayerFilters } from "../games/MapLayerFilters";
import type { UnifiedRow } from "@gobadminton/contracts";
import "../../../styles/radar-geographic.css";
function RadarMapModuleError({ onUnavailable }: { onUnavailable: () => void }) {
  useEffect(() => { onUnavailable(); }, [onUnavailable]);
  return <p role="alert" className="gb-map-position-unavailable">Не удалось загрузить участников Radar. Площадки и игры остаются на карте.</p>;
}
const GeographicRadarMap = dynamic(() => import("./GeographicRadarMap")
  .then(m => m.GeographicRadarMap)
  .catch(() => RadarMapModuleError), { ssr: false, loading: RadarMapModuleLoading });
export function RadarPage({ sharedMap, resumeCamera = false }: { sharedMap?: LibreMap; resumeCamera?: boolean } = {}) {
  const { view: session } = useRadarSession(); const { controller, view } = useUnifiedDirectory();
  const { applied: layerFilters } = useMapLayerFilters();
  const [failed, setFailed] = useState(false); const [listOpen, setListOpen] = useState(false); const [expanded, setExpanded] = useState(false);
  const [candidate, setCandidate] = useState(false); const sheet = useRef<HTMLElement>(null); const trigger = useRef<HTMLElement | null>(null);
  // Venue marker replacement clears player selection without restoring the old player trigger.
  const skipFocusRestore = useRef(false);
  // Exactly one owner for the current same-URL preview history entry (Close must not also retire).
  const previewHistoryOwned = useRef(false);
  // Ownership generation: live player→player reuse keeps the same generation; a new push advances it.
  const previewHistoryGeneration = useRef(0);
  // Programmatic history.back() of an older generation must not close a newer player listener.
  const pendingRetiredGeneration = useRef<number | null>(null);
  // Single popstate coordinator: active player handler, or orphan-clear when none.
  const previewPopstateHandler = useRef<(() => void) | null>(null);
  const selectedRef = useRef(view.selected);
  selectedRef.current = view.selected;
  const snapshot = view.snapshot;
  // Keep the map marker identity stable between one-second header ticks;
  // the exact-deadline timer below invalidates this array when a lease expires.
  const safeMapPins = useMemo(() => view.pins.filter(row => row.radar &&
    Date.parse(row.radar.validUntil) > Date.now()), [view.pins]);
  const privateMapDeadline = Math.min(...view.pins.filter(row => row.radar)
    .map(row => Date.parse(row.radar!.validUntil)), Infinity);
  // Display-layer only: hiding pins must not stop session, consent or publication.
  const showPlayersLayer = layerFilters.showPlayersNearby;
  useEffect(() => {
    if (showPlayersLayer || !sharedMap) return;
    controller?.close();
    setListOpen(false);
    setExpanded(false);
  }, [showPlayersLayer, sharedMap, controller]);
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
  useEffect(() => {
    if (!sharedMap) return;
    if (view.selected) setExpanded(false);
    else if (!skipFocusRestore.current && trigger.current?.isConnected) trigger.current.focus();
    skipFocusRestore.current = false;
  }, [view.selected]);
  useEffect(() => { if (listOpen) sheet.current?.focus(); }, [listOpen]);
  // One window listener for preview history; player effects publish/replace the active handler.
  useEffect(() => {
    if (!sharedMap) return;
    const onPopstate = () => {
      const handler = previewPopstateHandler.current;
      if (handler) {
        handler();
        return;
      }
      // Orphan programmatic retirement (venue handoff with no new player yet).
      pendingRetiredGeneration.current = null;
    };
    window.addEventListener("popstate", onPopstate);
    return () => window.removeEventListener("popstate", onPopstate);
  }, [sharedMap]);
  useEffect(() => {
    if (!sharedMap || !view.selected) return;
    // Reuse the owned same-URL entry across live player→player replacement; push only when unowned.
    if (!previewHistoryOwned.current) {
      window.history.pushState({ ...window.history.state, gbRadarPreview: true }, "", window.location.href);
      previewHistoryOwned.current = true;
      previewHistoryGeneration.current += 1;
    }
    const ownedGeneration = previewHistoryGeneration.current;
    previewPopstateHandler.current = () => {
      // Absorb a pending programmatic retirement from a prior ownership; do not close the new player.
      if (pendingRetiredGeneration.current !== null && pendingRetiredGeneration.current < ownedGeneration) {
        pendingRetiredGeneration.current = null;
        return;
      }
      pendingRetiredGeneration.current = null;
      // Browser Back / Escape already retired the entry before popstate.
      previewHistoryOwned.current = false;
      previewPopstateHandler.current = null;
      controller?.close(); setListOpen(false); setExpanded(false);
    };
    return () => {
      // Live replacement: keep ownership and let the incoming effect replace the handler.
      if (selectedRef.current) return;
      previewPopstateHandler.current = null;
      // Sole retirement path for ordinary Close, venue replacement, and other non-Back clears.
      // Do not also history.back() from close(): native back is async and would double-pop.
      if (previewHistoryOwned.current && window.history.state?.gbRadarPreview) {
        pendingRetiredGeneration.current = previewHistoryGeneration.current;
        previewHistoryOwned.current = false;
        window.history.back();
      }
    };
  }, [view.selected, controller]);
  useEffect(() => {
    if (!sharedMap || !controller || !activationId) return;
    // Keep the existing bounded page-window API. Panning or PageDown exposes
    // the next window without adding a permanent map control or accumulating pins.
    const next = () => { const current = controller.snapshot(); if (!current.busy && current.mapPage?.nextMapCursor) void controller.map(true); };
    // The existing status popover and canvas shortcut open the same sheet.
    const openList = () => {
      trigger.current = document.activeElement as HTMLElement;
      window.dispatchEvent(new Event("gb-map-select-player"));
      controller.close();
      setExpanded(false);
      setListOpen(true);
    };
    const key = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open], [role=dialog]")) return;
      if (event.key === "PageDown") { event.preventDefault(); next(); }
      if (event.key.toLowerCase() === "l") openList();
    };
    const canvas = sharedMap.getCanvas();
    canvas.setAttribute("aria-description", "Стрелки перемещают карту. PageDown — следующие участники Radar. L — список участников на карте.");
    canvas.addEventListener("keydown", key); sharedMap.on("dragend", next);
    window.addEventListener("gb-radar-map-list", openList);
    return () => { window.removeEventListener("gb-radar-map-list", openList); canvas.removeEventListener("keydown", key); sharedMap.off("dragend", next); canvas.removeAttribute("aria-description"); };
  }, [sharedMap, controller, activationId]);
  // Venue selection dispatches gb-map-select-venue synchronously; close player/list in that same turn.
  useEffect(() => {
    if (!sharedMap) return;
    const onVenue = () => {
      skipFocusRestore.current = true;
      controller?.close();
      setListOpen(false);
      setExpanded(false);
    };
    window.addEventListener("gb-map-select-venue", onVenue);
    return () => window.removeEventListener("gb-map-select-venue", onVenue);
  }, [sharedMap, controller]);
  function close() {
    // Selection clear's effect cleanup owns the single history retirement; do not back here.
    controller?.close(); setListOpen(false); setExpanded(false);
    requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); });
  }
  // Compact-only window Escape; expanded/games-view Escape stays on UnifiedPlayerPreview.
  useEffect(() => {
    if (!sharedMap || !view.selected || expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open], [role=dialog]")) return;
      event.preventDefault();
      if (window.history.state?.gbRadarPreview) {
        // Claim retirement before async native back so effect cleanup cannot double-pop.
        // Mark generation so a player selected before popstate can absorb without closing.
        pendingRetiredGeneration.current = previewHistoryGeneration.current;
        previewHistoryOwned.current = false;
        window.history.back();
      } else { controller?.close(); setListOpen(false); setExpanded(false); }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [sharedMap, view.selected, expanded, controller]);
  const selectPlayer = (row: UnifiedRow) => {
    trigger.current = document.activeElement as HTMLElement;
    setListOpen(false);
    setExpanded(false);
    window.dispatchEvent(new Event("gb-map-select-player"));
    void controller?.select(row);
  };
  const layerPins = showPlayersLayer && session.phase === "active" && session.confirmedOn && !session.pendingStop ? safeMapPins : [];
  const mapped = candidate && !failed && controller && session.me;
  const mapLayer = mapped && sharedMap ? <GeographicRadarMap resumeCamera={resumeCamera} sharedMap={sharedMap} controller={controller} rows={layerPins} playersVisible={showPlayersLayer} selected={view.selected} onSelect={selectPlayer} onUnavailable={() => setFailed(true)} /> : null;
  if (!sharedMap) return <main id="gb-main" className="gb-consumer g2-radar-map gb-shared-fullscreen" aria-label="Карта игр, площадок и Radar"><GamesMapViewport fullscreen><GamesMapView cityId={cityId ?? MOSCOW_BUNDLE.cityId} day="" /></GamesMapViewport><Link className="gb-map-return" href="/players" onClick={() => window.dispatchEvent(new Event("gb-map-return"))}><span aria-hidden="true">←</span>К списку</Link><div className="gb-map-radar"><RadarStatusAffordance mapControls /></div></main>;
  return <div className="gb-consumer gb-radar-layer fr3" aria-label="Карта участников Radar">
    {mapLayer}
    {failed && <p role="alert" className="gb-map-position-unavailable">Не удалось загрузить участников Radar. Площадки и игры остаются на карте.</p>}
    {session.confirmedOn && session.status?.state === "active" && !session.status.coarseCenter && <p role="status" className="gb-map-position-unavailable">Опубликованная геопозиция недоступна. Площадки города остаются на карте.</p>}
    {mapped && <><div hidden className="g2-map-summary gb-map-layer-summary"><button aria-expanded={listOpen} aria-controls="g2-map-panel" onClick={() => { trigger.current = document.activeElement as HTMLElement; window.dispatchEvent(new Event("gb-map-select-player")); if (!listOpen) controller.close(); setExpanded(false); setListOpen(!listOpen); }}>{view.busy ? "Загружаем игроков…" : `На карте: ${view.pins.length} из ${snapshot?.totals.radarTotal ?? 0}`}</button><small>Приблизительные геопозиции. {view.mapPage?.hasMore ? "Показана часть участников." : ""}</small>{view.mapPage?.nextMapCursor && <Button variant="outline" disabled={view.busy} onClick={() => void controller.map(true)}>Следующие точки</Button>}{view.notice && <small role="status">{view.notice}</small>}</div>
      {view.selected && <VenuePopup key={view.selected} expanded={expanded} onExpandedChange={setExpanded} onDeselect={close}
        labels={{ dialog: "Выбранный игрок", expandHandle: "Развернуть игрока", collapseHandle: "Свернуть игрока" }}
        preview={<UnifiedPlayerPreview surface="compact" onClose={close} onOpen={() => setExpanded(true)} />}>
        <UnifiedPlayerPreview surface="detail" onClose={close} onCollapse={() => setExpanded(false)} skipFocusRestore={skipFocusRestore} />
      </VenuePopup>}
      {listOpen && !view.selected && <aside id="g2-map-panel" ref={sheet} tabIndex={-1} aria-label="Игроки на карте" className="g2-map-panel is-expanded" onKeyDown={e => { if (e.key === "Escape" && !(e.target as Element).closest("dialog")) { e.stopPropagation(); close(); } }}>
        <header><CloseButton aria-label="Закрыть список игроков" onClick={close} /></header>
        <h2>Игроки на карте</h2>{view.pins.map(row => <button className="g2-map-list-row" key={row.publicPlayerId} onClick={() => selectPlayer(row)}><strong>{row.player.displayName}</strong><small>{distanceText(row.radar?.distance ?? null) ?? "Расстояние неизвестно"}</small></button>)}
      </aside>}
    </>}
  </div>;
}
