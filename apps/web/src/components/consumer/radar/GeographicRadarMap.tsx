"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import type { UnifiedRow } from "@gobadminton/contracts";
import { listAllCityVenues } from "../../../lib/api-client";
import type { VenueSummary } from "../../../lib/consumer-types";
import { MOSCOW_BUNDLE, allowedMapResource, mapBundleForHost } from "../../../lib/radar-map-assets";
import { initialsFromName } from "../../../lib/player-presentation";
import type { UnifiedDirectoryController } from "../../../lib/unified-directory";
type MappedVenue = VenueSummary & { latitude: number; longitude: number };
function moscowVenue(venue: VenueSummary): venue is MappedVenue {
  return venue.cityId === MOSCOW_BUNDLE.cityId && typeof venue.latitude === "number" && typeof venue.longitude === "number" &&
    Number.isFinite(venue.latitude) && Number.isFinite(venue.longitude) &&
    venue.latitude >= 54.5 && venue.latitude <= 56.5 && venue.longitude >= 36 && venue.longitude <= 39.5;
}
let protocol: Protocol | undefined;
function installProtocol() {
  if (!protocol) {
    // MapLibre v6 needs an explicit bundled worker URL in Next.js.
    maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    protocol = new Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile);
  }
}
export function GeographicRadarMap({ controller, rows, selected, onSelect, onVenueCount, onUnavailable }: { controller: UnifiedDirectoryController | null; rows: UnifiedRow[]; selected: string | null; onSelect: (row: UnifiedRow) => void; onVenueCount: (count: number) => void; onUnavailable: () => void }) {
  const container = useRef<HTMLDivElement>(null); const map = useRef<LibreMap | null>(null);
  const markers = useRef<Array<{ marker: maplibregl.Marker; button: HTMLButtonElement; id: string }>>([]);
  const venueMarkers = useRef<maplibregl.Marker[]>([]);
  const [venues, setVenues] = useState<MappedVenue[]>([]);
  const [venueNotice, setVenueNotice] = useState<string | null>(null);
  const callbacks = useRef({ onSelect, onUnavailable, onVenueCount }); callbacks.current = { onSelect, onUnavailable, onVenueCount };
  const [ready, setReady] = useState(false); const [status, setStatus] = useState("Загружаем карту города…");
  useEffect(() => {
    let current = true;
    // Public metadata only. No Radar session, GPS permission or private player
    // query is required to show a venue on Germany DEV.
    void listAllCityVenues(MOSCOW_BUNDLE.cityId).then(result => {
      if (!current) return;
      if (!result.ok) {
        setVenueNotice("Не удалось загрузить площадки. Карта доступна без них.");
        callbacks.current.onVenueCount(0);
        return;
      }
      const published = result.data.filter(moscowVenue);
      setVenues(published);
      callbacks.current.onVenueCount(published.length);
      setVenueNotice(published.length ? null : "В каталоге нет площадок Москвы с проверенными координатами.");
    });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    let alive = true; const abort = new AbortController(); let instance: LibreMap | undefined;
    const timeout = setTimeout(() => { if (alive && !instance?.loaded()) callbacks.current.onUnavailable(); }, 20000);
    async function start() {
      try {
        const bundle = mapBundleForHost(window.location.hostname);
        const response = await fetch(bundle.prefix + ("styleFile" in bundle ? bundle.styleFile : "style.json"), { credentials: "omit", signal: abort.signal });
        if (!response.ok) throw new Error("style");
        const bytes = await response.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
        if (hash !== bundle.styleHash) throw new Error("style identity");
        const style = JSON.parse(new TextDecoder().decode(bytes)) as StyleSpecification;
        if (!alive || !container.current) return;
        installProtocol();
        instance = new maplibregl.Map({ container: container.current, style, center: controller?.camera?.center ?? bundle.center, zoom: controller?.camera?.zoom ?? 10.5, maxBounds: bundle.bounds, maxZoom: 16, attributionControl: { compact: false }, dragRotate: false, pitchWithRotate: false,
          transformRequest: url => { if (!allowedMapResource(url, bundle)) throw new Error("Unapproved map resource"); return { url, credentials: "same-origin" }; },
        });
        instance.touchZoomRotate.disableRotation(); map.current = instance;
        instance.on("load", () => { if (alive) { setReady(true); setStatus(""); clearTimeout(timeout); } });
        instance.on("error", () => { if (alive) callbacks.current.onUnavailable(); });
        instance.on("moveend", () => { if (instance) { const center = instance.getCenter(); if (controller) controller.camera = { center: [center.lng, center.lat], zoom: instance.getZoom() }; } });
        instance.getCanvas().setAttribute("aria-label", "Карта Москвы: стрелки перемещают карту, плюс и минус меняют масштаб");
      } catch { if (alive) callbacks.current.onUnavailable(); }
    }
    void start();
    const resize = new ResizeObserver(() => instance?.resize()); if (container.current) resize.observe(container.current);
    return () => { alive = false; abort.abort(); clearTimeout(timeout); resize.disconnect(); markers.current.forEach(m => m.marker.remove()); markers.current = []; venueMarkers.current.forEach(marker => marker.remove()); venueMarkers.current = []; instance?.remove(); map.current = null; };
  }, [controller]);
  useEffect(() => {
    if (!ready || !map.current) return;
    markers.current.forEach(m => m.marker.remove()); markers.current = [];
    for (const row of rows) {
      const geo = row.radar?.geo;
      // Invalid or revoked Radar geo must never produce a point or infer a city location.
      if (!geo || geo.crs !== "EPSG:4326" || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude) || geo.longitude < 36 || geo.longitude > 39.5 || geo.latitude < 54.5 || geo.latitude > 56.5) continue;
      const button = document.createElement("button"); button.type = "button"; button.className = "g2-map-marker";
      button.textContent = initialsFromName(row.player.displayName); button.setAttribute("aria-label", `Показать игрока: ${row.player.displayName}`); button.setAttribute("aria-pressed", String(row.publicPlayerId === selected));
      button.addEventListener("click", () => callbacks.current.onSelect(row));
      const marker = new maplibregl.Marker({ element: button, anchor: "center" }).setLngLat([geo.longitude, geo.latitude]).addTo(map.current);
      markers.current.push({ marker, button, id: row.publicPlayerId });
    }
    // Selection focus survives subsequent tick renders; source rows change only on a new window.
  }, [rows, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    venueMarkers.current.forEach(marker => marker.remove());
    venueMarkers.current = [];
    for (const venue of venues) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "g2-map-venue-marker";
      button.textContent = "⌾";
      button.setAttribute("aria-label", `Площадка: ${venue.name}`);
      button.addEventListener("click", () => {
        const content = document.createElement("div");
        const title = document.createElement("strong"); title.textContent = venue.name;
        const address = document.createElement("p"); address.textContent = venue.address;
        content.append(title, address);
        new maplibregl.Popup({ offset: 18, maxWidth: "270px" })
          .setLngLat([venue.longitude, venue.latitude]).setDOMContent(content).addTo(instance);
      });
      venueMarkers.current.push(new maplibregl.Marker({ element: button, anchor: "center" })
        .setLngLat([venue.longitude, venue.latitude]).addTo(instance));
    }
    return () => { venueMarkers.current.forEach(marker => marker.remove()); venueMarkers.current = []; };
  }, [venues, ready]);
  useEffect(() => { for (const marker of markers.current) marker.button.setAttribute("aria-pressed", String(marker.id === selected)); }, [selected]);
  function fit() {
    if (!map.current) return;
    const points = rows.flatMap(row => row.radar ? [[row.radar.geo.longitude, row.radar.geo.latitude] as [number, number]] : []);
    if (!points.length) points.push(...venues.map(venue => [venue.longitude, venue.latitude] as [number, number]));
    if (!points.length) { map.current.easeTo({ center: MOSCOW_BUNDLE.center, zoom: 10.5, duration: 0 }); return; }
    const bounds = new maplibregl.LngLatBounds(); points.forEach(p => bounds.extend(p));
    map.current.fitBounds(bounds, { padding: { top: 100, bottom: 180, left: 60, right: 60 }, maxZoom: 13, duration: 0 });
  }
  return <><div ref={container} className="g2-map-canvas" data-map-ready={ready} />{status && <p className="g2-map-loading" role="status">{status}</p>}{venueNotice && <p className="g2-map-venue-notice" role="status">{venueNotice}</p>}<div className="g2-map-camera" aria-label="Управление картой"><button aria-label="Увеличить карту" onClick={() => map.current?.zoomIn()}>+</button><button aria-label="Уменьшить карту" onClick={() => map.current?.zoomOut()}>−</button><button aria-label="Показать всех полученных игроков" onClick={fit}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg></button></div></>;
}
