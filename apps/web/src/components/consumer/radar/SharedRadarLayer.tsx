"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Marker, type Map as LibreMap } from "maplibre-gl";
import { getMySocialProfile } from "../../../lib/api-client";
import type { OwnSocialProfile } from "../../../lib/consumer-types";
import { candidateMapConfigAllowed } from "../../../lib/radar-map-assets";
import { Button } from "../Button";
import { Avatar } from "../players/ProfileComposition";
import { UnifiedPlayerPreview } from "./UnifiedPlayerPreview";
import { useDirectoryFilters, useRadarConfig, useRadarSession, useUnifiedDirectory } from "./RadarSessionProvider";

/** People are a private, independently revocable layer on the public venue map. */
export function SharedRadarLayer({ map, cityId, restoredCamera }: { map: LibreMap; cityId: string; restoredCamera: boolean }) {
  const { view: session } = useRadarSession();
  const { controller, view } = useUnifiedDirectory();
  const { filters } = useDirectoryFilters(); const config = useRadarConfig();
  const [own, setOwn] = useState<OwnSocialProfile | null>(null);
  const [portals, setPortals] = useState<Array<{ element: HTMLButtonElement; publicPlayerId: string; name: string; avatar?: OwnSocialProfile["avatar"]; own?: boolean }>>([]);
  const centered = useRef(false); const interacted = useRef(false);
  const trigger = useRef<HTMLElement | null>(null); const panel = useRef<HTMLElement>(null);
  const active = session.phase === "active" && session.confirmedOn && !session.pendingStop && session.status?.state === "active" && session.status.contractVersion === "players-unified-radar-v1";
  const permitted = active && candidateMapConfigAllowed(config, cityId, window.location.origin);
  const activationId = active && session.status?.state === "active" ? session.status.activationId : null;
  const activationKey = activationId && session.status && "version" in session.status ? `${activationId}:${session.status.version}` : null;
  const queryFilters = { cityId, areaKey: filters.areaKey.trim() || undefined, name: filters.name.trim().length >= 2 ? filters.name.trim() : undefined, looking: filters.lookingOnly || undefined, trainer: filters.trainerOnly || undefined };
  const filterKey = JSON.stringify(queryFilters);
  useEffect(() => {
    if (!permitted || !controller || !activationId || !config?.unifiedDirectory.enabled) return;
    const recover = () => { const current = controller.snapshot(); if (!current.busy && !current.capabilityUnavailable && !current.authenticationRequired && !controller.matches(queryFilters, activationKey)) void controller.query(queryFilters, { kind: "current_activation", activationId }, activationKey); };
    recover(); const timer = setInterval(recover, 30000); return () => clearInterval(timer);
  }, [permitted, controller, activationId, activationKey, filterKey, config]);
  useEffect(() => {
    if (permitted && controller && view.snapshot && !view.mapPage && !view.busy) void controller.map();
  }, [permitted, controller, view.snapshot?.query.queryRef, view.mapPage, view.busy]);
  useEffect(() => {
    let alive = true; setOwn(null);
    if (permitted && session.me) void getMySocialProfile().then(result => { if (alive && result.ok) setOwn(result.data); });
    return () => { alive = false; };
  }, [permitted, session.me?.id]);
  useEffect(() => {
    const moved = (event: { originalEvent?: unknown }) => { if (event.originalEvent) interacted.current = true; };
    map.on("movestart", moved); return () => { map.off("movestart", moved); };
  }, [map]);
  const center = permitted && session.status?.state === "active" ? session.status.coarseCenter : undefined;
  const validCenter = center && Number.isFinite(center.latitude) && Number.isFinite(center.longitude) && center.longitude >= 36 && center.longitude <= 39.5 && center.latitude >= 54.5 && center.latitude <= 56.5 ? center : undefined;
  useEffect(() => {
    if (!validCenter || !own?.socialEligible || !own.radarConsented || centered.current || interacted.current) return;
    centered.current = true;
    // Preserve the saved map when returning from a venue/game or browser history.
    if (!restoredCamera) map.jumpTo({ center: [validCenter.longitude, validCenter.latitude] });
  }, [map, validCenter?.latitude, validCenter?.longitude, own, restoredCamera]);
  useEffect(() => {
    const markers: Marker[] = []; const content: typeof portals = [];
    if (permitted && own?.socialEligible && own.radarConsented) {
      for (const row of view.pins) {
        if (row.publicPlayerId === own.publicPlayerId || !row.radar || Date.parse(row.radar.validUntil) <= Date.now()) continue;
        const geo = row.radar.geo;
        if (!geo || geo.crs !== "EPSG:4326" || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude) || geo.longitude < 36 || geo.longitude > 39.5 || geo.latitude < 54.5 || geo.latitude > 56.5) continue;
        const element = document.createElement("button"); element.type = "button"; element.className = "g2-map-marker gb-person-marker";
        element.setAttribute("aria-label", `Показать игрока: ${row.player.displayName}`); element.setAttribute("aria-pressed", String(view.selected === row.publicPlayerId));
        element.onclick = () => { if (map.isMoving()) return; trigger.current = element; void controller?.select(row); };
        markers.push(new Marker({ element }).setLngLat([geo.longitude, geo.latitude]).addTo(map));
        content.push({ element, publicPlayerId: row.publicPlayerId, name: row.player.displayName, avatar: row.player.avatar });
      }
      if (validCenter) {
        const element = document.createElement("button"); element.type = "button"; element.className = "g2-map-marker gb-person-marker gb-person-marker--own";
        element.setAttribute("aria-label", `Вы: ${own.displayName}`);
        element.onclick = () => { window.location.assign("/profile"); };
        markers.push(new Marker({ element }).setLngLat([validCenter.longitude, validCenter.latitude]).addTo(map));
        content.push({ element, publicPlayerId: own.publicPlayerId, name: own.displayName, avatar: own.avatar, own: true });
      }
    }
    setPortals(content);
    return () => { markers.forEach(marker => marker.remove()); };
  }, [map, permitted, own, view.pins, validCenter?.latitude, validCenter?.longitude, controller]);
  useEffect(() => {
    for (const item of portals) {
      if (!item.own) item.element.setAttribute("aria-pressed", String(view.selected === item.publicPlayerId));
    }
  }, [view.selected, portals]);
  useEffect(() => {
    if (!permitted) controller?.close();
  }, [permitted, controller]);
  useEffect(() => {
    if (view.selected) panel.current?.focus(); else if (trigger.current?.isConnected) trigger.current.focus();
  }, [view.selected]);
  return <>{portals.map(item => createPortal(<Avatar name={item.name} avatar={item.avatar} />, item.element))}
    {permitted && view.mapPage?.nextMapCursor && <div className="gb-map-people-page"><Button variant="outline" disabled={view.busy} onClick={() => void controller?.map(true)}>Следующие участники на карте</Button></div>}
    {permitted && own && !validCenter && <p className="gb-map-exception" role="status">Ваша опубликованная геопозиция недоступна.</p>}
    {permitted && view.selected && <aside ref={panel} tabIndex={-1} className="g2-map-panel" aria-label="Игрок на карте" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); controller?.close(); } }}><UnifiedPlayerPreview onClose={() => controller?.close()} /></aside>}
  </>;
}
